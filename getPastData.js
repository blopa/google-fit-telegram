require('dotenv').config();
const { google } = require('googleapis');
const { writeFileSync } = require('fs');

const fitness = google.fitness('v1');
const NUMBER_OF_DAYS = 400;

const scopes = require('./scopes');

function nanosToDateString(nanos) {
    const milliseconds = parseInt(nanos, 10) / 1000000;
    return new Date(milliseconds).toLocaleDateString('en-GB');
}

async function fetchDataForDataSource(dataSourceId, auth, startTimeNs, endTimeNs) {
    const response = await fitness.users.dataSources.datasets.get({
        userId: 'me',
        dataSourceId,
        datasetId: `${startTimeNs}-${endTimeNs}`,
        auth,
    });

    return response.data;
}

function extractBodyData(jsonArray, type) {
    return jsonArray.point.map((dataPoint) => {
        const date = nanosToDateString(dataPoint.startTimeNanos);
        const data = dataPoint.value[0].fpVal;
        return { date, [type]: data };
    });
}

async function fetchData() {
    if (!process.env.TOKEN_TYPE || !process.env.CLIENT_ID || !process.env.CLIENT_SECRET || !process.env.REFRESH_TOKEN) {
        throw new Error('Missing environment variables');
    }

    const auth = await google.auth.fromJSON({
        type: process.env.TOKEN_TYPE,
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        refresh_token: process.env.REFRESH_TOKEN,
    });

    auth.scopes = scopes;

    const weightDataSource = 'derived:com.google.weight:com.google.android.gms:merge_weight';
    const fatPercentageDataSource = 'derived:com.google.body.fat.percentage:com.google.android.gms:merged';

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - NUMBER_OF_DAYS);

    const startTimeNs = startDate.getTime() * 1000000;
    const endTimeNs = endDate.getTime() * 1000000;

    const weightData = await fetchDataForDataSource(weightDataSource, auth, startTimeNs, endTimeNs);
    const fatPercentageData = await fetchDataForDataSource(fatPercentageDataSource, auth, startTimeNs, endTimeNs);

    const weightArray = extractBodyData(weightData, 'weight');
    const fatPercentageArray = extractBodyData(fatPercentageData, 'fatPercentage');

    const mergedData = {};

    weightArray.forEach((item) => {
        if (!mergedData[item.date]) {
            mergedData[item.date] = {};
        }

        mergedData[item.date].weight = item.weight;
    });

    fatPercentageArray.forEach((item) => {
        if (!mergedData[item.date]) {
            mergedData[item.date] = {};
        }

        mergedData[item.date].fatPercentage = item.fatPercentage;
    });

    const dataArray = Object.keys(mergedData).map((date) => ({
        date,
        weight: mergedData[date].weight || null,
        fatPercentage: mergedData[date].fatPercentage || null,
    }));

    writeFileSync('weight_fat_data.json', JSON.stringify(dataArray, null, 2));
}

fetchData().catch(console.error);
