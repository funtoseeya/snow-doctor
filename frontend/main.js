// The internal Flask endpoint to fetch cleaned AvCanada data
const AVDATA_API_URL = '/api/avdata';
// The internal Flask endpoint to request the LLM summary
const LLM_API_URL = '/api/llmsummary';

/**
 * Utility function for exponential backoff during API calls.
 */
async function fetchWithRetry(url, options = {}, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);
            if (!response.ok) {
                // If it's a 4xx or 5xx error, and it's the last attempt, throw
                if (i === retries - 1) throw new Error(`HTTP error! status: ${response.status}`);
                // Otherwise, wait and retry (only for non-successful responses)
                await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
            } else {
                return response;
            }
        } catch (error) {
            if (i === retries - 1) throw error;
            console.warn(`Fetch attempt ${i + 1} failed. Retrying in ${Math.pow(2, i + 1)}s...`);
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, i + 1) * 1000));
        }
    }
}


/**
 * Renders the cleaned data to the DOM.
 * This is the first step of rendering, showing the user the raw forecast.
 * @param {Object} cleanedData - The object containing all cleaned forecast details.
 */
function renderCleanedData(cleanedData) {
    
    // FIX: Debug check for primary data structure to prevent "Cannot read properties of undefined" errors
    if (!cleanedData || !cleanedData.reportMetadata) {
        throw new Error("Critical: Cleaned data or report metadata is missing.");
    }
    
    const loadingState = document.getElementById('loading-state');
    const dataContainer = document.getElementById('data-output-container');
    const llmContainer = document.getElementById('llm-output');
    
    // Update loading state to indicate we're moving to the LLM step
    if (loadingState) {
        loadingState.innerHTML = `
            <p class="font-semibold text-blue-700">Forecast Data Loaded.</p>
            <p class="text-blue-600">Now generating AI safety briefing (this may take a few seconds)...</p>
        `;
    }
    
    // Clear LLM summary area since it hasn't arrived yet
    if (llmContainer) {
        llmContainer.innerHTML = '';
    }

    // --- Render Report Metadata ---
    const metadata = cleanedData.reportMetadata;
    
    // FIX DEBUG ISSUE: Ensures the date fields are not null/undefined before passing to Date()
    const issuedDate = metadata.dateIssued ? new Date(metadata.dateIssued).toLocaleDateString() : 'N/A';
    const validUntilDate = metadata.validUntil ? new Date(metadata.validUntil).toLocaleDateString() : 'N/A';

    const metadataHtml = `
        <h3 class="text-xl font-semibold mb-3 pt-4 border-t">Report Metadata</h3>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm mb-6">
            <div class="bg-gray-100 p-3 rounded-lg"><p class="font-medium text-gray-600">Forecaster</p><p class="font-bold">${metadata.forecaster}</p></div>
            <div class="bg-gray-100 p-3 rounded-lg"><p class="font-medium text-gray-600">Confidence</p><p class="font-bold">${metadata.confidence}</p></div>
            <div class="bg-gray-100 p-3 rounded-lg"><p class="font-medium text-gray-600">Issued</p><p>${issuedDate}</p></div>
            <div class="bg-gray-100 p-3 rounded-lg"><p class="font-medium text-gray-600">Valid Until</p><p>${validUntilDate}</p></div>
        </div>
    `;

    // --- Render Daily Danger Ratings (Multi-Day) ---
    const dangerCards = cleanedData.dailyRatings.map(day => {
        // Function to assign a color class based on the danger level
        const getColorClass = (danger) => {
            if (danger.toUpperCase() === 'HIGH') return 'text-red-600';
            if (danger.toUpperCase() === 'CONSIDERABLE') return 'text-orange-500';
            if (danger.toUpperCase() === 'MODERATE') return 'text-yellow-600';
            if (danger.toUpperCase() === 'LOW') return 'text-green-600';
            return 'text-gray-500';
        };

        return `
            <div class="p-4 bg-white rounded-lg shadow-md flex-1 min-w-[200px] border border-gray-200">
                <h4 class="text-lg font-bold mb-3 text-center text-primary-600">${day.dateDisplay}</h4>
                <div class="space-y-2">
                    <div class="flex justify-between items-center text-sm"><span class="font-medium text-gray-600">Alpine:</span> <span class="text-base font-semibold ${getColorClass(day.dangerAlpine)}">${day.dangerAlpine}</span></div>
                    <div class="flex justify-between items-center text-sm"><span class="font-medium text-gray-600">Treeline:</span> <span class="text-base font-semibold ${getColorClass(day.dangerTreeline)}">${day.dangerTreeline}</span></div>
                    <div class="flex justify-between items-center text-sm"><span class="font-medium text-gray-600">Below Treeline:</span> <span class="text-base font-semibold ${getColorClass(day.dangerBelowTreeline)}">${day.dangerBelowTreeline}</span></div>
                </div>
            </div>
        `;
    }).join('');


    if (dataContainer) {
        dataContainer.innerHTML = metadataHtml + `
            <h3 class="text-xl font-semibold mb-3">Overall Summary</h3>
            <div class="bg-gray-50 p-4 rounded-lg shadow-inner mb-6">
                <p class="text-gray-700">${cleanedData.summary}</p>
            </div>

            <h3 class="text-xl font-semibold mb-3">Multi-Day Danger Ratings</h3>
            <div class="flex flex-wrap gap-4 justify-start">
                ${dangerCards}
            </div>
        `;
    }
}

/**
 * Renders the LLM output to the DOM.
 * This is the second step of rendering, showing the generated briefing.
 * @param {string} llmSummary - The generated text summary.
 * @param {string} areaName - The name of the forecast area.
 */
function renderLlmSummary(llmSummary, areaName) {
    const loadingState = document.getElementById('loading-state');
    const llmContainer = document.getElementById('llm-output');
    
    // Hide the loading state once the LLM response is received
    if (loadingState) {
        loadingState.classList.add('hidden');
    }
    
    // Render LLM Summary
    if (llmContainer) {
        // Simple markdown to HTML conversion for strong emphasis (**) and newlines
        const formattedSummary = llmSummary
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .split('\n')
            .map(p => p.trim() ? `<p>${p}</p>` : '')
            .join('');

        llmContainer.innerHTML = `
            <h2 class="text-2xl font-semibold mb-3 text-gray-800">${areaName} Safety Briefing</h2>
            <div class="llm-summary-card">
                ${formattedSummary}
            </div>
        `;
    }
}


/**
 * Utility function to display a major error message on the UI.
 * @param {string} message - The error message to display.
 */
function renderError(message) {
    const loadingState = document.getElementById('loading-state');
    if (loadingState) {
        loadingState.classList.add('hidden');
    }
    
    const container = document.querySelector('.container');
    if (container) {
        const errorHtml = `
            <div class="mt-5 p-4 bg-red-100 border-l-4 border-red-500 text-red-700 rounded-md">
                <h1 class="text-xl font-bold mb-2">Error Loading Forecast</h1>
                <p class="text-base">${message}</p>
            </div>
        `;
        // Clear previous content (llm-output and data-output-container) and show error
        const llmOutput = document.getElementById('llm-output');
        const dataOutputContainer = document.getElementById('data-output-container');
        if (llmOutput) llmOutput.innerHTML = '';
        if (dataOutputContainer) dataOutputContainer.innerHTML = '';
        container.insertAdjacentHTML('afterbegin', errorHtml);
    }
}


/**
 * Main function to orchestrate the fetch and processing steps in two stages.
 */
async function fetchDataAndProcess() {
    console.log("--- Starting Two-Stage Flask API Call ---");

    let cleanedData = null;

    // --- STAGE 1: Fetch and Display AvCanada Data ---
    try {
        console.log(`1. Fetching AvCanada Data from: ${AVDATA_API_URL}`);
        
        const avdataResponse = await fetchWithRetry(AVDATA_API_URL);
        const avdataResult = await avdataResponse.json();

        // Check for the Flask error structure
        if (avdataResult && avdataResult.error) {
             throw new Error(avdataResult.error);
        }
        
        cleanedData = avdataResult.cleanedData;
        console.log("-> AvCanada Data Loaded and Cleaned.");
        
        // Render the raw forecast data immediately
        renderCleanedData(cleanedData);

    } catch (error) {
        console.error("--- Critical STAGE 1 Error (AvCanada Data Fetch) ---");
        console.error(error.message);
        renderError(`Could not load forecast data: ${error.message}`);
        return; // Stop execution if Stage 1 fails
    }


    // --- STAGE 2: Generate and Display LLM Summary ---
    try {
        console.log(`2. Requesting LLM Summary from: ${LLM_API_URL}`);
        
        const llmResponse = await fetchWithRetry(LLM_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cleanedData: cleanedData }) // Send cleaned data for LLM processing
        });
        const llmResult = await llmResponse.json();

        // Check for the Flask error structure
        if (llmResult && llmResult.error) {
             throw new Error(llmResult.error);
        }

        const llmSummary = llmResult.llmSummary;
        console.log("-> LLM Summary Generated.");
        
        // Render the LLM summary
        renderLlmSummary(llmSummary, cleanedData.areaName);

    } catch (error) {
        console.error("--- Critical STAGE 2 Error (LLM Generation) ---");
        console.error(error.message);
        // Display a specialized error message for the LLM step, without clearing the already displayed forecast data
        document.getElementById('llm-output').innerHTML = `
            <div class="mt-5 p-4 bg-red-100 border-l-4 border-red-500 text-red-700 rounded-md">
                <h1 class="text-xl font-bold mb-2">LLM Generation Error</h1>
                <p class="text-base">Failed to generate safety briefing: ${error.message}</p>
            </div>
        `;
        document.getElementById('loading-state').classList.add('hidden');
    }
}

// Call the main function when the page is fully loaded
window.onload = fetchDataAndProcess;