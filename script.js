require('dotenv').config();
const { google } = require('googleapis');
const { writeFileSync } = require('fs');
// const path = require('path');
const nodeFetch = require('node-fetch');
const scopes = require('./scopes');

const fitness = google.fitness('v1');
const NUMBER_OF_DAYS = 5;
const CALORIES_PER_KG_FAT = 7700;
const CALORIES_PER_KG_MUSCLE = 5940;

function nanosToDateString(nanos) {
    const milliseconds = parseInt(nanos, 10) / 1000000;
    return new Date(milliseconds).toLocaleDateString('en-GB');
}

function extractCaloriesExpendedData(caloriesObject) {
    const transformedData = [];

    if (!caloriesObject || !caloriesObject.point || !Array.isArray(caloriesObject.point)) {
        return transformedData;
    }

    caloriesObject.point.forEach((entry) => {
        const date = nanosToDateString(entry.startTimeNanos);
        const calories = entry.value[0].fpVal;

        transformedData.push({ date, calories_expended: calories });
    });

    return transformedData;
}

function extractStepsData(stepsObject) {
    const transformedData = [];

    if (!stepsObject || !stepsObject.point || !Array.isArray(stepsObject.point)) {
        return transformedData;
    }

    stepsObject.point.forEach((entry) => {
        const date = nanosToDateString(entry.startTimeNanos);
        const steps = entry.value[0].intVal;

        transformedData.push({ date, steps });
    });

    return transformedData;
}

function extractHeartMinutesData(heartMinutesObject) {
    const transformedData = [];

    if (!heartMinutesObject || !heartMinutesObject.point || !Array.isArray(heartMinutesObject.point)) {
        return transformedData;
    }

    heartMinutesObject.point.forEach((entry) => {
        const date = nanosToDateString(entry.startTimeNanos);
        const heartMinutes = entry.value[0].fpVal;

        transformedData.push({ date, heartMinutes });
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
            foodName: dataPoint.value[2].stringVal || '',
            protein: nutritionValues.protein || 0,
            fat: nutritionValues['fat.total'] || 0,
            carbs: nutritionValues['carbs.total'] || 0,
            calories: nutritionValues.calories || 0,
            fiber: nutritionValues.dietary_fiber || 0,
            sugar: nutritionValues.sugar || 0,
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

function aggregateCaloriesExpendedData(caloriesExpendedArray) {
    const aggregatedData = {};

    caloriesExpendedArray.forEach((caloriesExpended) => {
        const { date, ...caloriesExpendedValues } = caloriesExpended;

        if (!aggregatedData[date]) {
            aggregatedData[date] = {
                date,
                ...caloriesExpendedValues,
            };
        } else {
            Object.keys(caloriesExpendedValues).forEach((key) => {
                if (Object.prototype.hasOwnProperty.call(caloriesExpendedValues, key)) {
                    aggregatedData[date][key] += caloriesExpendedValues[key];
                }
            });
        }
    });

    return Object.values(aggregatedData);
}

function aggregateStepsData(stepsArray) {
    const aggregatedData = {};

    stepsArray.forEach((steps) => {
        const { date, ...stepsValues } = steps;

        if (!aggregatedData[date]) {
            aggregatedData[date] = {
                date,
                ...stepsValues,
            };
        } else {
            Object.keys(stepsValues).forEach((key) => {
                if (Object.prototype.hasOwnProperty.call(stepsValues, key)) {
                    aggregatedData[date][key] += stepsValues[key];
                }
            });
        }
    });

    return Object.values(aggregatedData);
}

function aggregateHeartMinutesData(heartMinutesArray) {
    const aggregatedData = {};

    heartMinutesArray.forEach((heartMinutes) => {
        const { date, ...heartMinutesValues } = heartMinutes;

        if (!aggregatedData[date]) {
            aggregatedData[date] = {
                date,
                ...heartMinutesValues,
            };
        } else {
            Object.keys(heartMinutesValues).forEach((key) => {
                if (Object.prototype.hasOwnProperty.call(heartMinutesValues, key)) {
                    aggregatedData[date][key] += heartMinutesValues[key];
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

function calculateStatistics(dataArray) {
    const totalDays = dataArray.length;
    let totalCalories = 0;
    let totalCaloriesExpended = 0;
    let totalSteps = 0;
    let totalHeartMinutes = 0;
    let totalProtein = 0;
    let totalCarbs = 0;
    let totalFat = 0;
    let totalFiber = 0;
    let initialWeight = 0;
    let finalWeight = 0;
    let firstOccurrence = null;
    let lastOccurrence = null;

    dataArray.forEach((data) => {
        totalCaloriesExpended += data.calories_expended;
        totalSteps += data.steps;
        totalHeartMinutes += data.heartMinutes;
        totalCalories += data.calories;
        totalProtein += data.protein;
        totalCarbs += data.carbs;
        totalFat += data.fat;
        totalFiber += data.fiber;

        if (!firstOccurrence) {
            firstOccurrence = data;
            initialWeight = data.weight;
        }

        lastOccurrence = data;
        finalWeight = data.weight;
    });

    const weightDifference = finalWeight - initialWeight;

    const initialFat = (firstOccurrence.fat_percentage * initialWeight) / 100;
    const finalFat = (lastOccurrence.fat_percentage * finalWeight) / 100;
    const fatDifference = finalFat - initialFat;

    const muscleDifference = weightDifference - fatDifference;
    const fatDifferencePercentage = lastOccurrence.fat_percentage - firstOccurrence.fat_percentage;

    const muscleCalories = CALORIES_PER_KG_MUSCLE * muscleDifference;
    const fatCalories = CALORIES_PER_KG_FAT * fatDifference;
    const caloriesDifference = fatCalories + muscleCalories;
    const tdee = (totalCalories - caloriesDifference) / totalDays;
    // console.log({
    //     steps,
    //     finalWeight,
    //     initialWeight,
    //     tdee,
    //     totalCalories,
    //     caloriesDifference,
    //     totalDays,
    //     fatCalories,
    //     muscleCalories,
    //     fatDifferencePercentage,
    //     fatDifference,
    //     muscleDifference,
    //     weightDifference,
    // });

    return [
        `*From ${firstOccurrence.date} to ${lastOccurrence.date}*\n`,
        `Days Range: ${totalDays}`,
        `TDEE: ${tdee?.toFixed(2)} kcal`,
        `Average Calories: ${(totalCalories / totalDays)?.toFixed(2)} kcal`,
        `Average Steps: ${(totalSteps / totalDays)?.toFixed(2)} kcal`,
        `Average Heart Points: ${(totalHeartMinutes / totalDays)?.toFixed(2)} kcal`,
        `Average Expended Calories: ${(totalCaloriesExpended / totalDays)?.toFixed(2)} kcal`,
        `Average Protein: ${(totalProtein / totalDays)?.toFixed(2)} g`,
        `Average Carbs: ${(totalCarbs / totalDays)?.toFixed(2)} g`,
        `Average Fat: ${(totalFat / totalDays)?.toFixed(2)} g`,
        `Average Fiber: ${(totalFiber / totalDays)?.toFixed(2)} g`,
        `Weight Difference: ${weightDifference > 0 ? '+' : ''}${weightDifference?.toFixed(2)} kg (${initialWeight?.toFixed(2)} -> ${finalWeight?.toFixed(2)})`,
        `Fat Difference: ${fatDifference > 0 ? '+' : ''}${fatDifference?.toFixed(2)} kg`,
        `Non-Fat Difference: ${muscleDifference > 0 ? '+' : ''}${muscleDifference?.toFixed(2)} kg`,
        `Fat Percentage Difference: ${fatDifferencePercentage > 0 ? '+' : ''}${fatDifferencePercentage?.toFixed(2)}%  (${firstOccurrence.fat_percentage?.toFixed(2)} -> ${lastOccurrence.fat_percentage?.toFixed(2)})`,
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
    const caloriesExpendedDataSources = 'derived:com.google.calories.expended:com.google.android.gms:merge_calories_expended';
    const stepCountDataSources = 'derived:com.google.step_count.delta:com.google.android.gms:merge_step_deltas';
    const heartMinutesDataSources = 'derived:com.google.heart_minutes:com.google.android.gms:merge_heart_minutes';
    const sleepDataSources = 'derived:com.google.sleep.segment:com.google.android.gms:merged';

    const endDate = new Date();
    // endDate.setDate(endDate.getDate() - 1);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - (NUMBER_OF_DAYS + 1));

    let startTimeNs = startDate.getTime() * 1000000;
    let endTimeNs = endDate.getTime() * 1000000;
    // console.log({ startTimeNs, endTimeNs });

    const data = await fetchDataForDataSource(sleepDataSources, auth, startTimeNs, endTimeNs);
    writeFileSync('output/google_fit_data2.json', JSON.stringify(((data)), null, 2));
    process.exit(0);

    const weightData = await fetchDataForDataSource(weightDataSources, auth, startTimeNs, endTimeNs);
    const fatPercentageData = await fetchDataForDataSource(fatPercentageDataSources, auth, startTimeNs, endTimeNs);

    // set start and end to be the same as the weight data
    startTimeNs = weightData.point[0].startTimeNanos;
    endTimeNs = weightData.point[weightData.point.length - 1].endTimeNanos;
    // console.log({ startTimeNs, endTimeNs });

    const nutritionData = await fetchDataForDataSource(nutritionDataSources, auth, startTimeNs, endTimeNs);
    const stepsData = await fetchDataForDataSource(stepCountDataSources, auth, startTimeNs, endTimeNs);
    const heartMinutesData = await fetchDataForDataSource(heartMinutesDataSources, auth, startTimeNs, endTimeNs);
    const caloriesExpendedData = await fetchDataForDataSource(
        caloriesExpendedDataSources,
        auth,
        startTimeNs,
        endTimeNs
    );

    function parseDate(dateStr) {
        const [day, month, year] = dateStr.split('/');
        return new Date(`${year}-${month}-${day}`);
    }

    const agragatedData = mergeDataArrays(
        extractBodyData(weightData, 'weight'),
        extractBodyData(fatPercentageData, 'fat_percentage'),
        aggregateNutritionData(extractNutritionData(nutritionData)),
        aggregateCaloriesExpendedData(extractCaloriesExpendedData(caloriesExpendedData)),
        aggregateStepsData(extractStepsData(stepsData)),
        aggregateHeartMinutesData(extractHeartMinutesData(heartMinutesData))
    )
        .sort((a, b) => {
            const dateA = parseDate(a.date);
            const dateB = parseDate(b.date);
            return dateA - dateB;
        })
        .filter((data) => data.calories > 0)
        .reduceRight((acc, item) => {
            if (item.calories || acc.length) {
                acc.unshift(item);
            }
            return acc;
        }, []);

    // writeFileSync('output/google_fit_data.json', JSON.stringify(agragatedData, null, 2));
    const text = calculateStatistics(agragatedData);
    console.log(
        text,
        // JSON.stringify(agragatedData),
        agragatedData
    );

    await nodeFetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_ID}/sendMessage`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            text,
            chat_id: process.env.TELEGRAM_GROUP_ID,
            parse_mode: 'markdown',
        }),
    });
};

fetchData().catch(console.error);
