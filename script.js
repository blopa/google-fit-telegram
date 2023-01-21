require('dotenv').config();
const nodeFetch = require('node-fetch');
const BASE_URL = 'https://fitness.googleapis.com/fitness/v1/users/me/dataset:aggregate';
const WEIGHT = 'com.google.weight';
const NUTRITION = 'com.google.nutrition';

async function getWeightData() {
    // Get the end and start time for the last 30 days
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(23, 59, 59);

    const endTime = yesterday.getTime();
    const startTime = endTime - (30 * 24 * 60 * 60 * 1000);
    const dataTypes = [WEIGHT, NUTRITION];
    const weightByDay = {};
    const caloriesByDay = {};

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
            'Authorization': `Bearer ${process.env.ACCESS_TOKEN}`
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

                    console.log(JSON.stringify(data));
                    data.bucket.forEach(({ dataset, endTimeMillis }) => {
                        dataset.forEach((dataset) => {
                            dataset.point.forEach((point) => {
                                if (point.value[0].fpVal > 0) {
                                    totalWeight += point.value[0].fpVal;
                                    count++;

                                    const date = new Date(endTimeMillis).toLocaleDateString('en-gb');
                                    console.log(endTimeMillis, date);
                                    process.exit(1);
                                    weightByDay[date] = point.value[0].fpVal;
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

                            const date = new Date(endTimeMillis).toLocaleDateString('en-UK');
                            caloriesByDay[date] = totalDailyCalories;
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

    console.log({caloriesByDay, weightByDay});
}

getWeightData();
