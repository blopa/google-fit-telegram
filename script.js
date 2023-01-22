require('dotenv').config();
const nodeFetch = require('node-fetch');
const { google } = require('googleapis');
const scopes = require('./scopes');

const BASE_URL = 'https://fitness.googleapis.com/fitness/v1/users/me/dataset:aggregate';
const WEIGHT = 'com.google.weight';
const NUTRITION = 'com.google.nutrition';

const dataTypes = {
    [WEIGHT]: {
        average: 0,
        total: 0,
        count: 0,
    },
    [NUTRITION]: {
        average: 0,
        total: 0,
        count: 0,
    }
};

const aggregatedData = {};

function convertStringToDate(string) {
    const [day, month, year] = string.split('/');
    return new Date(+year, month - 1, +day);
}

async function getFitnesstData() {
    // Validate environment variables
    if (!process.env.TOKEN_TYPE || !process.env.CLIENT_ID || !process.env.CLIENT_SECRET || !process.env.REFRESH_TOKEN) {
        throw new Error('Missing environment variables');
    }

    // Authenticate and authorize the client
    const auth = await google.auth.fromJSON({
        type: process.env.TOKEN_TYPE,
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        refresh_token: process.env.REFRESH_TOKEN,
    });

    auth.scopes = scopes;
    const { token: accessToken } = await auth.getAccessToken();

    // Get the end and start time for the last 30 days
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(23, 59, 59);

    const endTime = yesterday.getTime();
    const startTime = endTime - (30 * 24 * 60 * 60 * 1000);

    for (const dataTypeName of Object.keys(dataTypes)) {
        // Construct the body of the request
        const body = JSON.stringify({
            aggregateBy: [{
                // dataTypeName: 'com.google.weight',
                // dataTypeName: 'com.google.nutrition',
                dataTypeName,
            }],
            bucketByTime: { durationMillis: 86400000 },
            startTimeMillis: startTime,
            endTimeMillis: endTime
        });

        // Construct the headers of the request
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`
        };

        try {
            // Make the request to the API
            const response = await nodeFetch(BASE_URL, {
                method: 'POST',
                headers: headers,
                body: body
            });

            // Parse the response as JSON
            const data = await response.json();
            data.bucket.forEach(({ dataset, endTimeMillis }) => {
                dataset.forEach((dataset) => {
                    dataset.point.forEach((point) => {
                        let value = 0;

                        if (dataTypeName === WEIGHT) {
                            value = point.value[0].fpVal;
                        } else if (dataTypeName === NUTRITION) {
                            point.value[0].mapVal.forEach((macro) => {
                                if (macro.key === 'calories') {
                                    value = macro.value.fpVal;
                                }
                            });
                        }

                        if (value > 0) {
                            dataTypes[dataTypeName].total += value;
                            dataTypes[dataTypeName].count++;

                            const date = new Date(parseInt(endTimeMillis)).toLocaleDateString('en-gb');
                            if (!aggregatedData[date]) {
                                aggregatedData[date] = {};
                            }

                            if (!aggregatedData[date][dataTypeName]) {
                                aggregatedData[date][dataTypeName] = 0;

                            }

                            aggregatedData[date][dataTypeName] += value;
                        }
                    });
                });
            });
        } catch (error) {
            console.error(error);
        }
    }

    // Print the average weight and calories
    for (const dataTypeName in dataTypes) {
        const { total, count } = dataTypes[dataTypeName];
        dataTypes[dataTypeName].average = total / count;
        // console.log(`Average ${dataTypeName}:`, dataTypes[dataTypeName].average);
    }

    // console.log(aggregatedData);

    // Sort the dates
    const sortedDates = Object.keys(aggregatedData).sort(
        (a, b) => convertStringToDate(a) - convertStringToDate(b)
    );
    // console.log(sortedDates);

    // Create a new array
    const newArray = sortedDates.map((date) => {
        return {
            date,
            data: aggregatedData[date],
        };
    });

    console.log(newArray);
    // console.log(dataTypes);
}

getFitnesstData()
    .then(() => null)
    .catch(console.error);
