require('dotenv').config();
const { google } = require('googleapis');
const scopes = require('./scopes');
const { writeFileSync } = require('fs');
const path = require('path');

const fitness = google.fitness('v1');
const NUMBER_OF_DAYS = 6;

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

const fetchDataForDataSource = async (dataSourceId, auth) => {
    const today = new Date();
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(today.getDate() - NUMBER_OF_DAYS);

    const endTimeNs = today.getTime() * 1000000;
    const startTimeNs = thirtyDaysAgo.getTime() * 1000000;

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

    // const results = await Promise.all(dataSources.map(dataSource => fetchDataForDataSource(dataSource, auth)));
    //
    // const consolidatedData = {
    //     weightData: results[0],
    //     bodyFatPercentageData: results[1],
    //     nutritionData: results[2]
    // };

    const consolidatedData = await fetchDataForDataSource(dataSources[1], auth);

    writeFileSync('google_fit_data.json', JSON.stringify(extractBodyData(consolidatedData), null, 2));
    console.log("Data saved to google_fit_data.json");
};

fetchData().catch(console.error);
