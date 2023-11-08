const fs = require('fs');
const path = require('path');

// The workflow file path
const workflowFilePath = path.join(__dirname, '.github', 'workflows', 'run-task.yml');

// Calculate the last Sunday of a given month and year
function getLastSunday(year, month) {
    const lastDayOfMonth = new Date(year, month + 1, 0);
    const dayOfWeek = lastDayOfMonth.getDay();
    return new Date(year, month, lastDayOfMonth.getDate() - dayOfWeek);
}

// Determine if the current date is during DST for Amsterdam (CET/CEST)
function isCurrentlyDst() {
    const now = new Date();
    const currentYear = now.getFullYear();
    const startDst = getLastSunday(currentYear, 2); // March (0-indexed)
    const endDst = getLastSunday(currentYear, 9); // October (0-indexed)

    return now > startDst && now < endDst;
}

// Main function to update the cron schedule in the workflow file
function updateCronSchedule() {
    // Read the current workflow file
    fs.readFile(workflowFilePath, 'utf8', (err, data) => {
        if (err) {
            console.error('Error reading workflow file:', err);
            return;
        }

        // Calculate the new cron time based on DST
        const newCronTime = isCurrentlyDst() ? '59 21 * * *' : '59 22 * * *';

        // Replace the cron schedule with the newCronTime
        const updatedData = data.replace(/- cron: '.*'/, `- cron: '${newCronTime}'`);

        // Write the updated workflow file back to disk
        fs.writeFile(workflowFilePath, updatedData, 'utf8', (error) => {
            if (error) {
                console.error('Error writing updated workflow file:', error);
                return;
            }

            console.log('Workflow file has been updated with the new cron schedule.');
        });
    });
}

// Execute the main function
updateCronSchedule();
