require('dotenv').config();
const { google } = require('googleapis');
const scopes = require('./scopes');
const fit = google.fitness('v1');

async function getDataFromGoogleFit() {
    // Authenticate and authorize the client
    const auth = await google.auth.fromJSON({
        type: process.env.TOKEN_TYPE,
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        refresh_token: process.env.REFRESH_TOKEN,
    });
    auth.scopes = scopes;
    // await auth.authorize();

    // Get the dataSourceIds
    const dataSources = await fit.users.dataSources.list({ auth, userId: 'me' });
    // console.log(dataSources.data.dataSource);return;
    for (const dataSource of dataSources.data.dataSource) {
        if (dataSource.dataStreamId.includes('weight')) {
            const res = await fit.users.dataSources.datasets.get({
                auth,
                userId: 'me',
                dataSourceId: dataSource.dataStreamId,
                datasetId: '1579629957000-1674237957000',
            });

            console.log(res.data);
        }
    }
    return;
    // const dataSourceId = dataSources.data.dataSource
    //     .filter(dataSource => dataSource.dataStreamId.includes('weight'));
    // console.log(dataSources.data.dataSource.length, dataSourceId.map(a => a.dataStreamId));
    return;

    // console.log({dataSourceId});
    // return;

    // Get the end and start time for the last 30 days
    const endTime = new Date().getTime();
    const startTime = endTime - (30 * 24 * 60 * 60 * 1000);

    // Define the data types to be retrieved
    const dataTypeName1 = 'com.google.weight';
    const dataTypeName2 = 'com.google.body.fat.percentage';
    const dataTypeName3 = 'com.google.calories.expended';

    // Get the data from Google Fit
    const res = await fit.users.dataSources.datasets.get({
        auth,
        userId: 'me',
        // dataTypeName: 'com.google.weight.summary',
        // dataSourceId: `derived:com.google.${dataTypeName1}:*`,
        // dataSourceId: "derived:com.google.nutrition:com.google.android.gms:merged",
        dataSourceId: "derived:com.google.weight:com.google.android.gms:merge_weight",
        datasetId: `${startTime}-${endTime}`,
    });

    const res2 = await fit.users.dataSources.datasets.get({
        auth,
        userId: 'me',
        dataTypeName: dataTypeName2,
        dataSourceId: `derived:com.google.${dataTypeName2}:*`,
        datasetId: `${startTime}-${endTime}`,
    });

    const res3 = await fit.users.dataSources.datasets.get({
        auth,
        userId: 'me',
        dataTypeName: dataTypeName3,
        dataSourceId: `derived:com.google.${dataTypeName3}:*`,
        datasetId: `${startTime}-${endTime}`,
    });

    // Get the data points from the response
    const dataPoints1 = res.data.point;
    const dataPoints2 = res2.data.point;
    const dataPoints3 = res3.data.point;


    // Print the data points
    console.log(
        res,
        dataPoints1
    );
}

getDataFromGoogleFit();
