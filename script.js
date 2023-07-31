require('dotenv').config();
const { google } = require('googleapis');
// const { writeFileSync } = require('fs');
// const path = require('path');
const nodeFetch = require('node-fetch');
const scopes = require('./scopes');

const fitness = google.fitness('v1');
const NUMBER_OF_DAYS = 30;
const CALORIES_STORED_KG_FAT = 7700; // 82% fat, 8% proteins/carbs and 10% water.
const CALORIES_BUILD_KG_FAT = 8500; // efficiency to build fat is ~90%.
const CALORIES_STORED_KG_MUSCLE = 1500; // 20% protein, 4% proteins/carbs, 6% fat and 70% water.
const CALORIES_BUILD_KG_MUSCLE = 5600; // efficiency to build muscle is ~27%.

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
            sleptHours: Math.round(durationHours * 100) / 100,
            sleepType: type,
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
            foodName: dataPoint.value[2].stringVal || '',
            protein: nutritionValues.protein || 0,
            fat: nutritionValues['fat.total'] || 0,
            carbs: nutritionValues['carbs.total'] || 0,
            caloriesConsumed: nutritionValues.calories || 0,
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

function calculateStatistics(dataArray) {
    const totalDays = dataArray.length;
    const totalSleepDays = dataArray.filter((data) => data.sleptHours > 0).length;

    let totalCalories = 0;
    let totalEstimatedCaloriesExpended = 0;
    let totalSteps = 0;
    let totalSleptHours = 0;
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
        // nutrition
        totalCalories += data.caloriesConsumed;
        totalProtein += data.protein;
        totalCarbs += data.carbs;
        totalFat += data.fat;
        totalFiber += data.fiber;

        // health
        totalHeartMinutes += data.heartMinutes || 0;
        totalEstimatedCaloriesExpended += data.estimatedCaloriesExpended || 0;
        totalSteps += data.steps || 0;
        totalSleptHours += data.sleptHours || 0;

        if (!firstOccurrence) {
            firstOccurrence = data;
            initialWeight = data.weight;
        }

        lastOccurrence = data;
        finalWeight = data.weight;
    });

    const weightDifference = finalWeight - initialWeight;

    const initialFat = (firstOccurrence.fatPercentage * initialWeight) / 100;
    const finalFat = (lastOccurrence.fatPercentage * finalWeight) / 100;
    const fatDifference = finalFat - initialFat;

    const muscleDifference = weightDifference - fatDifference;
    const fatDifferencePercentage = lastOccurrence.fatPercentage - firstOccurrence.fatPercentage;

    const muscleCalories = muscleDifference > 0 ?
        muscleDifference * CALORIES_BUILD_KG_MUSCLE
        : muscleDifference * CALORIES_STORED_KG_MUSCLE;

    const fatCalories = fatDifference > 0 ?
        fatDifference * CALORIES_BUILD_KG_FAT
        : fatDifference * CALORIES_STORED_KG_FAT;

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
        `Average Expended Calories: ${(totalEstimatedCaloriesExpended / totalDays)?.toFixed(2)} kcal`,
        `Average Steps: ${(totalSteps / totalDays)?.toFixed(2)}`,
        `Average Slept Hours: ${(totalSleptHours / totalSleepDays)?.toFixed(2)}`,
        `Average Heart Points: ${(totalHeartMinutes / totalDays)?.toFixed(2)}`,
        `Average Protein: ${(totalProtein / totalDays)?.toFixed(2)} g`,
        `Average Carbs: ${(totalCarbs / totalDays)?.toFixed(2)} g`,
        `Average Fat: ${(totalFat / totalDays)?.toFixed(2)} g`,
        `Average Fiber: ${(totalFiber / totalDays)?.toFixed(2)} g`,
        `Weight Difference: ${weightDifference > 0 ? '+' : ''}${weightDifference?.toFixed(2)} kg (${initialWeight?.toFixed(2)} -> ${finalWeight?.toFixed(2)})`,
        `Fat Difference: ${fatDifference > 0 ? '+' : ''}${fatDifference?.toFixed(2)} kg`,
        `Non-Fat Difference: ${muscleDifference > 0 ? '+' : ''}${muscleDifference?.toFixed(2)} kg`,
        `Fat Percentage Difference: ${fatDifferencePercentage > 0 ? '+' : ''}${fatDifferencePercentage?.toFixed(2)}%  (${firstOccurrence.fatPercentage?.toFixed(2)} -> ${lastOccurrence.fatPercentage?.toFixed(2)})`,
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
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - (NUMBER_OF_DAYS + 1));

    let startTimeNs = startDate.getTime() * 1000000;
    let endTimeNs = endDate.getTime() * 1000000;
    // console.log({ startTimeNs, endTimeNs });

    const weightData = await fetchDataForDataSource(weightDataSources, auth, startTimeNs, endTimeNs);
    const fatPercentageData = await fetchDataForDataSource(fatPercentageDataSources, auth, startTimeNs, endTimeNs);

    // set start and end to be the same as the weight data
    startTimeNs = weightData.point[0].startTimeNanos;
    endTimeNs = weightData.point[weightData.point.length - 1].endTimeNanos;
    // console.log({ startTimeNs, endTimeNs });

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

    function parseDate(dateStr) {
        const [day, month, year] = dateStr.split('/');
        return new Date(`${year}-${month}-${day}`);
    }

    const agragatedData = mergeDataArrays(
        extractBodyData(weightData, 'weight'),
        extractBodyData(fatPercentageData, 'fatPercentage'),
        aggregateNutritionData(extractNutritionData(nutritionData)),
        aggregateSleepData(extractSleepData(sleepData)),
        aggregateData(extractFloatingPointData(estimatedCaloriesExpendedData, 'estimatedCaloriesExpended')),
        aggregateData(extractIntegerData(stepsData, 'steps')),
        aggregateData(extractFloatingPointData(heartMinutesData, 'heartMinutes'))
    )
        .sort((a, b) => {
            const dateA = parseDate(a.date);
            const dateB = parseDate(b.date);
            return dateA - dateB;
        })
        .filter((data) => data.caloriesConsumed > 0)
        .reduceRight((acc, item) => {
            if (item.caloriesConsumed || acc.length) {
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

    // const csvData = convertToCSV(agragatedData);
    // writeFileSync('output.csv', csvData, 'utf-8');

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
