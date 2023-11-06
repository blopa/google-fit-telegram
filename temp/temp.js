require('dotenv').config();
const axios = require('axios');
const { google } = require('googleapis');
const SCOPES = require('../scopes');

const fetchData = async () => {
    const auth = await google.auth.fromJSON({
        type: process.env.TOKEN_TYPE,
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        refresh_token: process.env.REFRESH_TOKEN,
    });

    auth.scopes = SCOPES;
    const { token: accessToken } = await auth.getAccessToken();

    const url = 'https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate';

    const headers = {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
    };

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 7);

    const body = {
        aggregateBy: [{
            dataTypeName: 'com.google.sleep.segment',
        }],
        bucketByTime: {
            durationMillis: 86400000, // 24 hours
        },
        startTimeMillis: startDate.getTime(),
        endTimeMillis: endDate.getTime(),
    };

    try {
        const response = await axios.post(url, body, {
            headers,
        });

        if (response.status === 200) {
            const { data } = response;
            console.log(data);
        } else {
            const errorData = response.data;
            console.error(`Error ${response.status}: ${response.statusText}`, errorData);
        }
    } catch (error) {
        console.error('Axios error:', error);
    }
};

fetchData();
