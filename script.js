require('dotenv').config();
const { google } = require('googleapis');
// const { writeFileSync } = require('fs');
// const path = require('path');
const axios = require('axios');
const scopes = require('./scopes');

const fitness = google.fitness('v1');
const NUMBER_OF_DAYS = process.env.NUMBER_OF_DAYS || 30;
const START_DATE = process.env.START_DATE || null;
const MACROS_OFFSET = JSON.parse(
    process.env.MACROS_OFFSET
    || JSON.stringify({
        protein: 0,
        carbs: 0,
        fat: 0,
        calories: 0,
        fiber: 0,
    })
);

// https://www.google.com/books/edition/The_Nutritionist/olIsBgAAQBAJ?hl=en&gbpv=1&pg=PA148&printsec=frontcover
// 1% other, 5% water, 8% protein, 86% fat.
// https://www.sciencedirect.com/science/article/pii/S2212877815000599/#sectitle0050
// efficiency to build fat is ~77%.
const CALORIES_STORED_KG_FAT = 7730;
const CALORIES_BUILD_KG_FAT = 8840;

// https://www.google.com/books/edition/The_Nutritionist/olIsBgAAQBAJ?hl=en&gbpv=1&pg=PA148&printsec=frontcover
// 2% fat, 4% other, 24% protein, 70% water.
// https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8387577/#sec-10title
// efficiency to build muscle is ~48%.
const CALORIES_STORED_KG_MUSCLE = 1250;
const CALORIES_BUILD_KG_MUSCLE = 3900;

function nanosToDateString(nanos) {
    const milliseconds = parseInt(nanos, 10) / 1000000;
    return new Date(milliseconds).toLocaleDateString('en-GB');
}

function extractFloatingPointData(dataObject, type) {
    const transformedData = [];

    if (!dataObject || !dataObject.point || !Array.isArray(dataObject.point)) {
        return transformedData;
    }

    dataObject.point.forEach((entry) => {
        const date = nanosToDateString(entry.startTimeNanos);
        const data = entry.value[0].fpVal;

        transformedData.push({ date, [type]: data });
    });

    return transformedData;
}

function extractIntegerData(dataObject, type) {
    const transformedData = [];

    if (!dataObject || !dataObject.point || !Array.isArray(dataObject.point)) {
        return transformedData;
    }

    dataObject.point.forEach((entry) => {
        const date = nanosToDateString(entry.startTimeNanos);
        const data = entry.value[0].intVal;

        transformedData.push({ date, [type]: data });
    });

    return transformedData;
}

function extractSleepData(sleepObject) {
    const transformedData = [];
    const sleepTypes = {
        1: 'Awake',
        2: 'Sleep',
        3: 'Out-of-bed',
        4: 'Light sleep',
        5: 'Deep sleep',
        6: 'REM sleep',
    };

    if (!sleepObject || !sleepObject.point || !Array.isArray(sleepObject.point)) {
        return [];
    }

    sleepObject.point.forEach((entry) => {
        const date = nanosToDateString(entry.startTimeNanos);
        const durationHours = (parseInt(entry.endTimeNanos, 10) - parseInt(entry.startTimeNanos, 10)) / (1e9 * 3600);
        const type = sleepTypes[entry.value[0].intVal];

        transformedData.push({
            date,
            sleepType: type,
            sleptHours: Math.round(durationHours * 100) / 100,
        });
    });

    return transformedData;
}

function extractBodyData(jsonArray, type) {
    return jsonArray.point.map((dataPoint) => {
        const date = nanosToDateString(dataPoint.startTimeNanos);
        const data = dataPoint.value[0].fpVal;
        return { date, [type]: data };
    });
}

function extractNutritionData(jsonData) {
    const nutritionArray = [];

    jsonData.point.forEach((dataPoint) => {
        const date = nanosToDateString(dataPoint.startTimeNanos);
        const nutritionValues = {};

        dataPoint.value[0].mapVal.forEach((item) => {
            nutritionValues[item.key] = item.value.fpVal;
        });

        nutritionArray.push({
            date,
            sugar: nutritionValues.sugar || 0,
            protein: nutritionValues.protein || 0,
            fat: nutritionValues['fat.total'] || 0,
            fiber: nutritionValues.dietary_fiber || 0,
            carbs: nutritionValues['carbs.total'] || 0,
            foodName: dataPoint.value[2].stringVal || '',
            caloriesConsumed: nutritionValues.calories || 0,
            saturatedFat: nutritionValues['fat.saturated'] || 0,
            unsaturatedFat: nutritionValues['fat.unsaturated'] || 0,
        });
    });

    return nutritionArray;
}

function aggregateNutritionData(nutritionArray) {
    const aggregatedData = {};

    nutritionArray.forEach((nutrition) => {
        const { date, foodName, ...nutritionValues } = nutrition;

        if (!aggregatedData[date]) {
            aggregatedData[date] = {
                date,
                foods: [foodName],
                ...nutritionValues,
            };
        } else {
            aggregatedData[date].foods.push(foodName);

            Object.keys(nutritionValues).forEach((key) => {
                if (Object.prototype.hasOwnProperty.call(nutritionValues, key)) {
                    aggregatedData[date][key] += nutritionValues[key];
                }
            });
        }
    });

    return Object.values(aggregatedData);
}

function aggregateSleepData(sleepArray) {
    const aggregatedData = {};

    sleepArray.forEach((sleep) => {
        const { date, sleepType, ...sleepValues } = sleep;

        if (!aggregatedData[date]) {
            aggregatedData[date] = {
                date,
                sleepType: [sleepType],
                ...sleepValues,
            };
        } else {
            aggregatedData[date].sleepType = [...new Set([...aggregatedData[date].sleepType, sleepType])];

            Object.keys(sleepValues).forEach((key) => {
                if (Object.prototype.hasOwnProperty.call(sleepValues, key)) {
                    aggregatedData[date][key] += sleepValues[key];
                }
            });
        }
    });

    return Object.values(aggregatedData);
}

function aggregateData(dataArray) {
    const aggregatedData = {};

    dataArray.forEach((data) => {
        const { date, ...dataValues } = data;

        if (!aggregatedData[date]) {
            aggregatedData[date] = {
                date,
                ...dataValues,
            };
        } else {
            Object.keys(dataValues).forEach((key) => {
                if (Object.prototype.hasOwnProperty.call(dataValues, key)) {
                    aggregatedData[date][key] += dataValues[key];
                }
            });
        }
    });

    return Object.values(aggregatedData);
}

const fetchDataForDataSource = async (dataSourceId, auth, startTimeNs, endTimeNs) => {
    const response = await fitness.users.dataSources.datasets.get({
        userId: 'me',
        dataSourceId,
        datasetId: `${startTimeNs}-${endTimeNs}`,
        auth,
    });

    return response.data;
};

function convertToCSV(data) {
    const headers = Object.keys(data[0]);
    const csv = [headers.join(',')];

    data.forEach((row) => {
        const values = [];
        headers.forEach((header) => {
            const value = row[header];
            if (Array.isArray(value)) {
                values.push(`"${value.join('|')}"`);
            } else {
                values.push(value);
            }
        });

        csv.push(values.join(','));
    });

    return csv.join('\n');
}

function mergeDataArrays(...arrays) {
    const mergedData = {};

    arrays.forEach((array) => {
        array.forEach((item) => {
            const { date, ...rest } = item;
            if (!mergedData[date]) {
                mergedData[date] = { date, ...rest };
            } else {
                Object.assign(mergedData[date], rest);
            }
        });
    });

    return Object.values(mergedData);
}

function accumulateData(dataArray) {
    const lastOccurrence = dataArray[dataArray.length - 1];
    const firstOccurrence = dataArray[0];

    const accumulator = {
        totalFat: MACROS_OFFSET.fat,
        totalSteps: 0,
        totalCarbs: MACROS_OFFSET.carbs,
        totalFiber: MACROS_OFFSET.fiber,
        totalProtein: MACROS_OFFSET.protein,
        totalCalories: MACROS_OFFSET.calories,
        totalSleptHours: 0,
        totalHeartMinutes: 0,
        totalSaturatedFat: 0,
        totalUnsaturatedFat: 0,
        totalEstimatedCaloriesExpended: 0,
        finalWeight: lastOccurrence?.weight,
        finalDate: lastOccurrence?.date || '',
        initialWeight: firstOccurrence?.weight,
        initialDate: firstOccurrence?.date || '',
        finalFatPercentage: lastOccurrence?.fatPercentage,
        initialFatPercentage: firstOccurrence?.fatPercentage,
    };

    dataArray.forEach((data) => {
        accumulator.totalSaturatedFat += data.saturatedFat;
        accumulator.totalUnsaturatedFat += data.unsaturatedFat;
        accumulator.totalCalories += data.caloriesConsumed;
        accumulator.totalProtein += data.protein;
        accumulator.totalFiber += data.fiber;
        accumulator.totalCarbs += data.carbs;
        accumulator.totalFat += data.fat;

        accumulator.totalSteps += data.steps || 0;
        accumulator.totalSleptHours += data.sleptHours || 0;
        accumulator.totalHeartMinutes += data.heartMinutes || 0;
        accumulator.totalEstimatedCaloriesExpended += data.estimatedCaloriesExpended || 0;
    });

    return accumulator;
}

function calculateWeightDifference(initialWeight, finalWeight, initialFatPercentage, finalFatPercentage) {
    const weightDifference = finalWeight - initialWeight;
    const initialFat = (initialFatPercentage * initialWeight) / 100;
    const finalFat = (finalFatPercentage * finalWeight) / 100;
    const fatDifference = finalFat - initialFat;
    const muscleDifference = weightDifference - fatDifference;
    const fatDifferencePercentage = finalFatPercentage - initialFatPercentage;

    return { weightDifference, fatDifference, muscleDifference, fatDifferencePercentage, finalFat };
}

function calculateMuscleAndFatCalories(muscleDifference, fatDifference) {
    const muscleCalories = muscleDifference > 0 ?
        muscleDifference * CALORIES_BUILD_KG_MUSCLE
        : muscleDifference * CALORIES_STORED_KG_MUSCLE;

    const fatCalories = fatDifference > 0 ?
        fatDifference * CALORIES_BUILD_KG_FAT
        : fatDifference * CALORIES_STORED_KG_FAT;

    return { muscleCalories, fatCalories };
}

function calculateTDEE(totalCalories, muscleCalories, fatCalories, totalDays) {
    const caloriesDifference = fatCalories + muscleCalories;

    return (totalCalories - caloriesDifference) / totalDays;
}

function calculateWeeklyAverages(dataArray) {
    const weeklyAverages = [];
    let currentWeek = [];

    dataArray.forEach((data, index) => {
        currentWeek.push(data);

        if (currentWeek.length === 7 || index === dataArray.length - 1) {
            const totalWeight = currentWeek.reduce((sum, item) => sum + (item.weight || 0), 0);
            const daysWithNoWeight = currentWeek.filter((item) => !item.weight).length;
            const daysWithNoFatPercentage = currentWeek.filter((item) => !item.fatPercentage).length;

            const totalFatPercentage = currentWeek.reduce((sum, item) => sum + (item.fatPercentage || 0), 0);
            const averageWeight = totalWeight / (currentWeek.length - daysWithNoWeight);
            const averageFatPercentage = totalFatPercentage / (currentWeek.length - daysWithNoFatPercentage);

            const weekStartDate = currentWeek[0].date;
            const weekEndDate = currentWeek[currentWeek.length - 1].date;

            weeklyAverages.push({
                weekStartDate,
                weekEndDate,
                averageWeight,
                averageFatPercentage,
            });

            currentWeek = [];
        }
    });

    return weeklyAverages;
}

function calculateStatistics(dataArray) {
    const totalDays = dataArray.length;
    const totalSleepDays = dataArray.filter((data) => data.sleptHours > 0).length;

    const {
        totalFat,
        finalDate,
        totalFiber,
        totalSteps,
        totalCarbs,
        initialDate,
        finalWeight,
        totalProtein,
        totalCalories,
        initialWeight,
        totalSleptHours,
        totalSaturatedFat,
        totalHeartMinutes,
        finalFatPercentage,
        totalUnsaturatedFat,
        initialFatPercentage,
        totalEstimatedCaloriesExpended,
    } = accumulateData(dataArray);

    const {
        fatDifference,
        weightDifference,
        muscleDifference,
        fatDifferencePercentage,
        finalFat,
    } = calculateWeightDifference(initialWeight, finalWeight, initialFatPercentage, finalFatPercentage);

    const { muscleCalories, fatCalories } = calculateMuscleAndFatCalories(muscleDifference, fatDifference);
    const tdee = calculateTDEE(totalCalories, muscleCalories, fatCalories, totalDays);

    const weeklyAverages = calculateWeeklyAverages(dataArray);
    // const weeklyAveragesText = weeklyAverages.map(
    //     ({ weekStartDate, weekEndDate, averageWeight, averageFatPercentage }) =>
    //         `*Week from ${weekStartDate} to ${weekEndDate}*\n`
    //         + `Average Weight: ${averageWeight.toFixed(2)} kg\n`
    //         + `Average Fat Percentage: ${averageFatPercentage.toFixed(2)}%\n`
    // ).join('\n');

    const weeklyAveragesText = weeklyAverages.map(
        ({ weekStartDate, weekEndDate, averageWeight, averageFatPercentage }, i) =>
            // `*Week ${i + 1}:* ${averageWeight.toFixed(2)} kg (${averageFatPercentage.toFixed(2)}%)`
            `*${weekStartDate.slice(0, -5)} to ${weekEndDate.slice(0, -5)}:* ${averageWeight.toFixed(2)} kg (${averageFatPercentage.toFixed(2)}%)`
    ).join('\n');

    return [
        `*From ${initialDate} to ${finalDate}*`,
        `Days Range: ${totalDays}`,
        '\n* - Nutrition Daily Averages - *',
        `TDEE: ${tdee?.toFixed(2)} kcal`,
        `Calories Intake: ${(totalCalories / totalDays)?.toFixed(2)} kcal`,
        `Protein Intake: ${(totalProtein / totalDays)?.toFixed(2)} g`,
        `Carbs Intake: ${(totalCarbs / totalDays)?.toFixed(2)} g`,
        `Fat Intake: ${(totalFat / totalDays)?.toFixed(2)} g`,
        `Saturated Fat Intake: ${(totalSaturatedFat / totalDays)?.toFixed(2)} g`,
        `Unsaturated Fat Intake: ${(totalUnsaturatedFat / totalDays)?.toFixed(2)} g`,
        `Fiber Intake: ${(totalFiber / totalDays)?.toFixed(2)} g`,
        '\n* - Health Daily Averages - *',
        `Expended Calories: ${(totalEstimatedCaloriesExpended / totalDays)?.toFixed(2)} kcal`,
        `Steps: ${(totalSteps / totalDays)?.toFixed(2)}`,
        `Slept Hours: ${(totalSleptHours / totalSleepDays)?.toFixed(2)}`,
        `Heart Points: ${(totalHeartMinutes / totalDays)?.toFixed(2)}`,
        '\n* - Progress - *',
        `Weight Difference: ${weightDifference > 0 ? '+' : ''}${weightDifference?.toFixed(2)} kg (${initialWeight?.toFixed(2)} -> ${finalWeight?.toFixed(2)})`,
        `Current Fat: ${finalFat?.toFixed(2)} kg (${finalFatPercentage?.toFixed(2)}%)`,
        `Fat Difference: ${fatDifference > 0 ? '+' : ''}${fatDifference?.toFixed(2)} kg`,
        `Non-Fat Difference: ${muscleDifference > 0 ? '+' : ''}${muscleDifference?.toFixed(2)} kg`,
        `Fat Percentage Difference: ${fatDifferencePercentage > 0 ? '+' : ''}${fatDifferencePercentage?.toFixed(2)}%  (${initialFatPercentage?.toFixed(2)} -> ${finalFatPercentage?.toFixed(2)})`,
        `\nYou're currently ${weightDifference > 0 ? 'gaining' : 'losing'} ${((Math.abs(weightDifference) / totalDays) * 7)?.toFixed(2)}kg per week`,
        `\n1% of your body fat is ${(finalFat / finalFatPercentage).toFixed(2)} kg`,
        `Eat ${(tdee - CALORIES_STORED_KG_FAT / 14)?.toFixed(2)} kcal per day to lose 500g of fat per week`,
        `Eat ${(tdee + CALORIES_BUILD_KG_MUSCLE / 14)?.toFixed(2)} kcal per day to gain 500g of muscle per week`,
        `Eat ${(tdee + (CALORIES_BUILD_KG_MUSCLE / 28) + (CALORIES_STORED_KG_FAT / 28))?.toFixed(2)} kcal per day to gain 250g of muscle and 250g of fat per week`,
        '\n* - Weekly Averages - *',
        weeklyAveragesText,
    ].join('\n');
}

const fetchData = async () => {
    // Validate environment variables
    if (
        !process.env.TOKEN_TYPE
        || !process.env.CLIENT_ID
        || !process.env.CLIENT_SECRET
        || !process.env.REFRESH_TOKEN
        || !process.env.TELEGRAM_BOT_ID
        || !process.env.TELEGRAM_GROUP_ID
    ) {
        throw new Error('Missing environment variables');
    }

    const auth = await google.auth.fromJSON({
        type: process.env.TOKEN_TYPE,
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        refresh_token: process.env.REFRESH_TOKEN,
    });

    auth.scopes = scopes;
    const weightDataSources = 'derived:com.google.weight:com.google.android.gms:merge_weight';
    const fatPercentageDataSources = 'derived:com.google.body.fat.percentage:com.google.android.gms:merged';
    const nutritionDataSources = 'derived:com.google.nutrition:com.google.android.gms:merged';
    const estimatedCaloriesExpendedDataSources = 'derived:com.google.calories.expended:com.google.android.gms:merge_calories_expended';
    const stepCountDataSources = 'derived:com.google.step_count.delta:com.google.android.gms:merge_step_deltas';
    const heartMinutesDataSources = 'derived:com.google.heart_minutes:com.google.android.gms:merge_heart_minutes';
    const sleepDataSources = 'derived:com.google.sleep.segment:com.google.android.gms:merged';

    const endDate = new Date();
    // endDate.setDate(endDate.getDate() - 1);
    // endDate.setHours(23, 59, 59, 0);
    const startDate = new Date(START_DATE || Date.now());
    if (!START_DATE) {
        startDate.setDate(startDate.getDate() - (NUMBER_OF_DAYS + 1));
    }

    let startTimeNs = startDate.getTime() * 1000000;
    let endTimeNs = endDate.getTime() * 1000000;
    // console.log({ startTimeNs, endTimeNs });
    // console.log(new Date(parseInt(endTimeNs, 10) / 1000000));
    // console.log(new Date(parseInt(startTimeNs, 10) / 1000000));

    const weightData = await fetchDataForDataSource(weightDataSources, auth, startTimeNs, endTimeNs);
    const fatPercentageData = await fetchDataForDataSource(fatPercentageDataSources, auth, startTimeNs, endTimeNs);

    // set start and end to be the same as the weight data
    startTimeNs = weightData.point[0].startTimeNanos;
    endTimeNs = weightData.point.at(-1).endTimeNanos;

    // console.log({ startTimeNs, endTimeNs });
    // console.log(new Date(parseInt(endTimeNs, 10) / 1000000));

    const nutritionData = await fetchDataForDataSource(nutritionDataSources, auth, startTimeNs, endTimeNs);
    const stepsData = await fetchDataForDataSource(stepCountDataSources, auth, startTimeNs, endTimeNs);
    const heartMinutesData = await fetchDataForDataSource(heartMinutesDataSources, auth, startTimeNs, endTimeNs);
    const sleepData = await fetchDataForDataSource(sleepDataSources, auth, startTimeNs, endTimeNs);
    const estimatedCaloriesExpendedData = await fetchDataForDataSource(
        estimatedCaloriesExpendedDataSources,
        auth,
        startTimeNs,
        endTimeNs
    );

    // const points = nutritionData.point;
    // points.sort((a, b) => parseInt(a.startTimeNanos, 10) - parseInt(b.startTimeNanos, 10));
    // console.log(new Date(parseInt(points.at(-1).startTimeNanos, 10) / 1000000));
    // writeFileSync('output/nutrition.json', JSON.stringify(points, null, 2));

    function parseDate(dateStr) {
        const [day, month, year] = dateStr.split('/');
        return new Date(`${year}-${month}-${day}`);
    }

    const extractedNutritionData = extractNutritionData(nutritionData);
    const aggregatedNutritionData = aggregateNutritionData(extractedNutritionData);

    // writeFileSync('output/BLOPA_google_fit_nutri_data.json', JSON.stringify(extractedNutritionData, null, 2));

    const agragatedData = mergeDataArrays(
        extractBodyData(weightData, 'weight'),
        aggregateSleepData(extractSleepData(sleepData)),
        extractBodyData(fatPercentageData, 'fatPercentage'),
        aggregateData(extractIntegerData(stepsData, 'steps')),
        aggregatedNutritionData,
        aggregateData(extractFloatingPointData(heartMinutesData, 'heartMinutes')),
        aggregateData(extractFloatingPointData(estimatedCaloriesExpendedData, 'estimatedCaloriesExpended'))
    )
        .sort((a, b) => {
            const dateA = parseDate(a.date);
            const dateB = parseDate(b.date);
            return dateA - dateB;
        })
        .filter((data) => data.caloriesConsumed > 0)
        .reduceRight((acc, item) => {
            if (item.fatPercentage || acc.length) {
                acc.unshift(item);
            }

            return acc;
        }, []);

    // writeFileSync('output/google_fit_data.json', JSON.stringify(agragatedData, null, 2));
    const text = calculateStatistics(agragatedData);
    // console.log(
    //     text,
    //     JSON.stringify(agragatedData),
    //     agragatedData
    // );

    // const csvData = convertToCSV(agragatedData);
    // writeFileSync('output.csv', csvData, 'utf-8');

    const response = await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_ID}/sendMessage`, {
        text,
        chat_id: process.env.TELEGRAM_GROUP_ID,
        parse_mode: 'markdown',
    }, {
        headers: {
            'Content-Type': 'application/json',
        },
    });
};

fetchData().catch(console.error);
