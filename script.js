require('dotenv').config();
const { google } = require('googleapis');
// const { writeFileSync } = require('fs');
// const path = require('path');
const nodeFetch = require('node-fetch');
const scopes = require('./scopes');

const fitness = google.fitness('v1');
const NUMBER_OF_DAYS = 30;
const CALORIES_PER_KG_FAT = 7700;
const CALORIES_PER_KG_MUSCLE = 5940;

function nanosToDateString(nanos) {
    const milliseconds = parseInt(nanos) / 1000000;
    return new Date(milliseconds).toLocaleDateString("en-GB");
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

    for (const dataPoint of jsonData.point) {
        const date = nanosToDateString(dataPoint.startTimeNanos);
        const nutritionValues = {};

        for (const item of dataPoint.value[0].mapVal) {
            nutritionValues[item.key] = item.value.fpVal;
        }

        nutritionArray.push({
            date: date,
            foodName: dataPoint.value[2].stringVal || "",
            protein: nutritionValues["protein"] || 0,
            fat: nutritionValues["fat.total"] || 0,
            carbs: nutritionValues["carbs.total"] || 0,
            calories: nutritionValues["calories"] || 0,
            fiber: nutritionValues["dietary_fiber"] || 0,
            sugar: nutritionValues["sugar"] || 0,
        });
    }

    return nutritionArray;
}

function aggregateNutritionData(nutritionArray) {
    const aggregatedData = {};

    for (const nutrition of nutritionArray) {
        const { date, foodName, ...nutritionValues } = nutrition;

        if (!aggregatedData[date]) {
            aggregatedData[date] = {
                date,
                ...nutritionValues,
            };
        } else {
            for (const key in nutritionValues) {
                if (nutritionValues.hasOwnProperty(key)) {
                    aggregatedData[date][key] += nutritionValues[key];
                }
            }
        }
    }

    return Object.values(aggregatedData);
}

const fetchDataForDataSource = async (dataSourceId, auth, startTimeNs, endTimeNs) => {
    const response = await fitness.users.dataSources.datasets.get({
        userId: 'me',
        dataSourceId: dataSourceId,
        datasetId: `${startTimeNs}-${endTimeNs}`,
        auth: auth
    });

    return response.data;
};

function mergeDataArrays(...arrays) {
    const mergedData = {};

    for (const array of arrays) {
        for (const item of array) {
            const { date, ...rest } = item;
            if (!mergedData[date]) {
                mergedData[date] = { date, ...rest };
            } else {
                Object.assign(mergedData[date], rest);
            }
        }
    }

    return Object.values(mergedData);
}

function calculateStatistics(dataArray) {
    let totalDays = 0;
    let totalCalories = 0;
    let totalProtein = 0;
    let totalCarbs = 0;
    let totalFat = 0;
    let initialWeight = 0;
    let finalWeight = 0;
    let firstOccurrence = null;
    let lastOccurrence = null;

    for (const data of dataArray) {
        totalDays++;
        totalCalories += data.calories;
        totalProtein += data.protein;
        totalCarbs += data.carbs;
        totalFat += data.fat;
        if (!firstOccurrence) {
            firstOccurrence = data;
            initialWeight = data.weight;
        }

        lastOccurrence = data;
        finalWeight = data.weight;
    }

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
        `Average Protein: ${(totalProtein / totalDays)?.toFixed(2)} g`,
        `Average Carbs: ${(totalCarbs / totalDays)?.toFixed(2)} g`,
        `Average Fat: ${(totalFat / totalDays)?.toFixed(2)} g`,
        `Weight Difference: ${weightDifference > 0 ? '+' : ''}${weightDifference?.toFixed(2)} kg (${initialWeight?.toFixed(2)} -> ${finalWeight?.toFixed(2)})`,
        `Fat Difference: ${fatDifference > 0 ? '+' : ''}${fatDifference?.toFixed(2)} kg`,
        `Non-Fat Difference: ${muscleDifference > 0 ? '+' : ''}${muscleDifference?.toFixed(2)} kg`,
        `Fat Percentage Difference: ${fatDifferencePercentage > 0 ? '+' : ''}${fatDifferencePercentage?.toFixed(2)}%  (${firstOccurrence.fat_percentage?.toFixed(2)} -> ${lastOccurrence.fat_percentage?.toFixed(2)})`,
    ].join('\n');
}

const fetchData = async () => {
    const auth = await google.auth.fromJSON({
        type: process.env.TOKEN_TYPE,
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        refresh_token: process.env.REFRESH_TOKEN,
    });

    auth.scopes = scopes;
    const dataSources = [
        "derived:com.google.weight:com.google.android.gms:merge_weight",
        "derived:com.google.body.fat.percentage:com.google.android.gms:merged",
        "derived:com.google.nutrition:com.google.android.gms:merged"
    ];

    const today = new Date();
    const someDaysAgo = new Date(today);
    someDaysAgo.setDate(today.getDate() - NUMBER_OF_DAYS);

    let startTimeNs = someDaysAgo.getTime() * 1000000;
    let endTimeNs = today.getTime() * 1000000;
    console.log({ startTimeNs, endTimeNs });

    const weightData = await fetchDataForDataSource(dataSources[0], auth, startTimeNs, endTimeNs);
    const fatPercentageData = await fetchDataForDataSource(dataSources[1], auth, startTimeNs, endTimeNs);

    // set start and end to be the same as the weight data
    startTimeNs = weightData.point[0].startTimeNanos;
    endTimeNs = weightData.point[weightData.point.length - 1].endTimeNanos;
    console.log({ startTimeNs, endTimeNs });

    const nutritionData = await fetchDataForDataSource(dataSources[2], auth, startTimeNs, endTimeNs);

    function parseDate(dateStr) {
        const [day, month, year] = dateStr.split('/');
        return new Date(`${year}-${month}-${day}`);
    }

    const agragatedData = mergeDataArrays(
        extractBodyData(weightData, 'weight'),
        extractBodyData(fatPercentageData, 'fat_percentage'),
        aggregateNutritionData(extractNutritionData(nutritionData))
    ).sort((a, b) => {
        const dateA = parseDate(a.date);
        const dateB = parseDate(b.date);
        return dateA - dateB;
    }).filter((data) => data.calories > 0);

    // writeFileSync('output/google_fit_data.json', JSON.stringify(agragatedData, null, 2));
    const text = calculateStatistics(agragatedData);
    console.log(text);
    console.log(agragatedData);

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
