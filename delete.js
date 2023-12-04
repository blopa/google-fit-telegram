require('dotenv').config();
const { google } = require('googleapis');
const { writeFileSync } = require('fs');

const scopes = require('./scopes');

const fitness = google.fitness('v1');

async function authenticate() {
    const auth = await google.auth.fromJSON({
        type: process.env.TOKEN_TYPE,
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        refresh_token: process.env.REFRESH_TOKEN,
    });
    auth.scopes = scopes;
    return auth;
}

async function listNutritionData(auth, startDate = null, endDate = null) {
    const startTime = startDate ? new Date(startDate).getTime() * 1000000 : 1698155280000000000;
    const endTime = endDate ? new Date(endDate).getTime() * 1000000 : 1698155280000000000;
    const datasetId = `${startTime}-${endTime}`;

    const res = await fitness.users.dataSources.datasets.get({
        userId: 'me',
        dataSourceId: 'derived:com.google.nutrition:com.google.android.gms:merged',
        datasetId,
        auth,
    });

    const dataPoints = res.data.point;
    dataPoints.forEach((point, index) => {
        // console.log(`Data Point ${index}:`, point);
    });

    // save dataPoints to a local json file
    writeFileSync('output/google_fit_nutri_data.json', JSON.stringify(dataPoints, null, 2));

    return dataPoints;
}

async function deleteDataPoint(auth, startTimeNanos, endTimeNanos) {
    const datasetId = `${startTimeNanos}-${endTimeNanos}`;

    const res = await fitness.users.dataSources.datasets.delete({
        userId: 'me',
        // dataSourceId: 'derived:com.google.nutrition:com.google.android.gms:merged',
        dataSourceId: 'raw:com.google.nutrition:com.google.android.apps.fitness:user_input',
        datasetId,
        auth,
    });

    console.log('Data Point deleted:', res.data);
}

async function main() {
    const auth = await authenticate();

    // const dataPoints = await listNutritionData(auth);
    // console.log('dataPoints', dataPoints.find(
    //     ({ value }) => value.find(({ mapVal }) => mapVal.find(
    //         (val) => val.key === 'calories' && val.value?.fpVal === 1724
    //     ))
    // ));

    await deleteDataPoint(auth, '1698155280000000000', '1698155280000000000');
}

main().catch(console.error);
