require('dotenv').config();
const nodeFetch = require('node-fetch');
const { google } = require('googleapis');
const scopes = require('./scopes');

// Constants
const BASE_URL = 'https://fitness.googleapis.com/fitness/v1/users/me/dataset:aggregate';

const WEIGHT_DATA_TYPE = 'com.google.weight';
const FAT_PERCENTAGE_DATA_TYPE = 'com.google.body.fat.percentage';
const NUTRITION_DATA_TYPE = 'com.google.nutrition';

const WEIGHT = 'weight';
const FAT_PERCENTAGE = 'fat_percentage';
const CALORIES = 'calories';
const PROTEIN = 'protein';

const CALORIES_PER_KG_FAT = 7700;
const CALORIES_PER_KG_MUSCLE = 5940;

const NUMBER_OF_DAYS = 30;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

const MORNING = 'morning';
const NIGHT = 'night';
const WEIGHT_MEASURAMENT_TIME = process.env.WEIGHT_MEASURAMENT_TIME || MORNING;

const dataTypes = {
    [FAT_PERCENTAGE]: {
        average: 0,
        total: 0,
        count: 0,
    },
    [CALORIES]: {
        average: 0,
        total: 0,
        count: 0,
    },
    [PROTEIN]: {
        average: 0,
        total: 0,
        count: 0,
    },
    [WEIGHT]: {
        average: 0,
        total: 0,
        count: 0,
    },
};

const aggregatedData = {};

function convertStringToDate(string) {
    const [day, month, year] = string.split('/');
    return new Date(+year, month - 1, +day);
}

function dd(arg) {
    console.log(JSON.stringify(arg));
    process.exit(1);
}

async function getFitnesstData() {
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

    // Authenticate and authorize the client
    const auth = await google.auth.fromJSON({
        type: process.env.TOKEN_TYPE,
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        refresh_token: process.env.REFRESH_TOKEN,
    });

    auth.scopes = scopes;
    const { token: accessToken } = await auth.getAccessToken();

    // Get the end and start time for the last NUMBER_OF_DAYS days
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const endTime = today.getTime();
    const startTime = endTime - (NUMBER_OF_DAYS * MILLISECONDS_PER_DAY);

    for (const dataTypeName of [FAT_PERCENTAGE_DATA_TYPE, NUTRITION_DATA_TYPE, WEIGHT_DATA_TYPE]) {
        // Construct the body of the request
        const body = JSON.stringify({
            aggregateBy: [{
                dataTypeName,
            }],
            bucketByTime: { durationMillis: MILLISECONDS_PER_DAY },
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
            data.bucket.forEach(({ dataset, startTimeMillis }) => {
                dataset.forEach((dataset) => {
                    dataset.point.forEach((point) => {
                        let value = 0;
                        let protein = 0;
                        let calories = 0;
                        let type = '';
                        const types = new Set();

                        if (dataTypeName === FAT_PERCENTAGE_DATA_TYPE) {
                            value = point.value[0].fpVal;
                            type = FAT_PERCENTAGE;
                            types.add(type);
                        } else if (dataTypeName === WEIGHT_DATA_TYPE) {
                            value = point.value[0].fpVal;
                            type = WEIGHT;
                            types.add(type);
                        } else if (dataTypeName === NUTRITION_DATA_TYPE) {
                            point.value[0].mapVal.forEach((macro) => {
                                // possible types: ['fat.total', 'sodium', 'potassium', 'fat.unsaturated', 'fat.saturated', 'protein', 'carbs.total', 'cholesterol', 'calories', 'sugar', 'dietary_fiber']
                                type = macro.key;

                                if (macro.key === CALORIES) {
                                    calories = macro.value.fpVal;
                                    types.add(type);
                                }
                                if (macro.key === PROTEIN) {
                                    protein = macro.value.fpVal;
                                    types.add(type);
                                }
                            });
                        }

                        if (value > 0 || protein > 0 || calories > 0) {
                            const date = new Date(parseInt(startTimeMillis)).toLocaleDateString('en-gb');
                            [...types].forEach((type) => {
                                const val = (type === PROTEIN ? protein : (type === CALORIES ? calories : value))
                                dataTypes[type].total += val;
                                dataTypes[type].count++;

                                if (!aggregatedData[date]) {
                                    aggregatedData[date] = {};
                                }

                                if (!aggregatedData[date][type]) {
                                    aggregatedData[date][type] = 0;

                                }

                                aggregatedData[date][type] += val;
                            });
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

    // Sort the dates
    const sortedDates = Object.keys(aggregatedData).sort(
        (a, b) => convertStringToDate(a) - convertStringToDate(b)
    );

    // Create a new array
    const newArray = sortedDates.map((date) => {
        return {
            date,
            data: aggregatedData[date],
        };
    }).filter((datum) => WEIGHT in datum.data && CALORIES in datum.data);

    const isMorning = WEIGHT_MEASURAMENT_TIME === MORNING;
    const isNight = WEIGHT_MEASURAMENT_TIME === NIGHT;

    let firstOccurrence = newArray.at(isMorning ? 1 : 0);
    let lastOccurrence = newArray.at(-1);
    let totalCalories = 0;
    let totalProtein = 0;
    let totalCount = 0;

    newArray.forEach((datum) => {
        if (isMorning && datum === lastOccurrence) {
            return;
        }

        totalCalories += datum.data[CALORIES];
        totalProtein += datum.data[PROTEIN];
        totalCount++;
    });

    const initialWeight = firstOccurrence.data[WEIGHT];
    const finalWeight = lastOccurrence.data[WEIGHT];
    const weightDifference = finalWeight - initialWeight;

    const initialFat = (firstOccurrence.data[FAT_PERCENTAGE] * initialWeight) / 100;
    const finalFat = (lastOccurrence.data[FAT_PERCENTAGE] * finalWeight) / 100;
    const fatDifference = finalFat - initialFat;
    const fatDifferencePercentage = lastOccurrence.data[FAT_PERCENTAGE] - firstOccurrence.data[FAT_PERCENTAGE];
    const fatCalories = CALORIES_PER_KG_FAT * fatDifference;

    const initialNonFatMass = initialWeight - initialFat;
    const finalNonFatMass = finalWeight - finalFat;
    const muscleDifference = finalNonFatMass - initialNonFatMass;
    const muscleCalories = CALORIES_PER_KG_MUSCLE * muscleDifference;

    const caloriesDifference = fatCalories + muscleCalories;
    const tdee = (totalCalories - caloriesDifference) / totalCount;

    const result = [
        `*From ${firstOccurrence.date} to ${lastOccurrence.date}*\n`,
        `Days Range: ${totalCount}`,
        `TDEE: ${tdee.toFixed(2)} kcal`,
        `Average Calories: ${(totalCalories / totalCount).toFixed(2)} kcal`,
        `Average Protein: ${(totalProtein / totalCount).toFixed(2)} g`,
        `Weight Difference: ${weightDifference > 0 ? '+' : ''}${weightDifference.toFixed(2)} kg`,
        `Muscle Difference: ${muscleDifference > 0 ? '+' : ''}${muscleDifference.toFixed(2)} kg`,
        `Fat Difference: ${fatDifference > 0 ? '+' : ''}${fatDifference.toFixed(2)} kg`,
        `Fat Percentage Difference: ${fatDifferencePercentage > 0 ? '+' : ''}${fatDifferencePercentage.toFixed(2)}%`,
    ].join('\n');

    console.info(`${result}\n`);
    console.info(`${JSON.stringify(newArray)}\n`);
    console.info(JSON.stringify({ caloriesDifference, totalCalories }));

    await nodeFetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_ID}/sendMessage`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            text: result,
            chat_id: process.env.TELEGRAM_GROUP_ID,
            parse_mode: 'markdown',
        }),
    });
}

getFitnesstData()
    .then(() => null)
    .catch(console.error);
