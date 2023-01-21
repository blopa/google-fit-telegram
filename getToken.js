const nodeFetch = require('node-fetch');

const getAccessToken = async () => {
    try {
        const response = await nodeFetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `grant_type=refresh_token&refresh_token=${process.env.REFRESH_TOKEN}&client_id=${process.env.CLIENT_ID}&client_secret=${process.env.CLIENT_SECRET}`
        });

        const data = await response.json();
        console.log(data);
    } catch (error) {
        console.error(error);
    }
};

getAccessToken();
