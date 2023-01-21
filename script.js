require('dotenv').config();
const nodeFetch = require('node-fetch');
const { google } = require('googleapis');
const scopes = require('./scopes');

const BASE_URL = 'https://fitness.googleapis.com/fitness/v1/users/me/dataset:aggregate';
const WEIGHT = 'com.google.weight';
const NUTRITION = 'com.google.nutrition';

function convertStringToDate(string) {
    const [day, month, year] = string.split('/');
    return new Date(+year, month - 1, +day);
}

async function getFitnesstData() {
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
    const dataTypes = [WEIGHT, NUTRITION];
    const aggregatedData = {};

    for (const dataTypeName of dataTypes) {
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
            switch (dataTypeName) {
                case WEIGHT: {
                    let totalWeight = 0;
                    let count = 0;

                    // console.log(JSON.stringify(data));
                    data.bucket.forEach(({ dataset, endTimeMillis }) => {
                        dataset.forEach((dataset) => {
                            dataset.point.forEach((point) => {
                                if (point.value[0].fpVal > 0) {
                                    totalWeight += point.value[0].fpVal;
                                    count++;

                                    const date = new Date(parseInt(endTimeMillis)).toLocaleDateString('en-gb');
                                    if (!aggregatedData[date]) {
                                        aggregatedData[date] = [];
                                    }

                                    aggregatedData[date].push(point.value[0].fpVal);
                                }
                            });
                        });
                    });

                    const averageWeight = totalWeight / count;
                    console.log("average weight: ", averageWeight);
                    break;
                }

                case NUTRITION: {
                    let totalCalories = 0;
                    let count = 0;

                    // console.log(JSON.stringify(data));
                    data.bucket.forEach(({ dataset, endTimeMillis }) => {
                        let totalDailyCalories = 0;

                        dataset.forEach((dataset) => {
                            dataset.point.forEach((point) => {
                                point.value[0].mapVal.forEach(macro => {
                                    if (macro.key === "calories") {
                                        if (macro.value.fpVal > 0) {
                                            totalDailyCalories += macro.value.fpVal;
                                        }
                                    }
                                });
                            });
                        });

                        if (totalDailyCalories > 0) {
                            count++;
                            totalCalories += totalDailyCalories;

                            const date = new Date(parseInt(endTimeMillis)).toLocaleDateString('en-gb');
                            if (!aggregatedData[date]) {
                                aggregatedData[date] = [];
                            }

                            aggregatedData[date].push(totalDailyCalories);
                        }
                    });

                    const averageCalories = totalCalories / count;
                    console.log("average calories: ", averageCalories);
                    break;
                }
            }
        } catch (err) {
            console.error(err);
        }
    }

    const sortedData = Object.entries(aggregatedData)
        .sort((a, b) => convertStringToDate(a[0]) - convertStringToDate(b[0]))
        .map(([date, value]) => ({ date, value }));

    console.log(sortedData);
}

getFitnesstData()
    .then(() => null)
    .catch(console.error);
