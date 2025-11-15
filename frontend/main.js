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


// --- Rendering Helpers ---

/**
 * Maps danger rating display strings to Tailwind color and background classes.
 * @param {string} dangerRating - e.g., "3 - Considerable", "2 - Moderate", "Early Season"
 * @returns {Object} { textClass, bgClass }
 */
function getRatingColorStyles(dangerRating) {
    const rating = dangerRating.toUpperCase();
    if (rating.includes('HIGH')) return { textClass: 'text-white', bgClass: 'bg-red-700' };
    if (rating.includes('CONSIDERABLE')) return { textClass: 'text-white', bgClass: 'bg-orange-500' };
    if (rating.includes('MODERATE')) return { textClass: 'text-white', bgClass: 'bg-yellow-600' };
    if (rating.includes('LOW')) return { textClass: 'text-white', bgClass: 'bg-green-600' };
    if (rating.includes('EXTREME')) return { textClass: 'text-white', bgClass: 'bg-black' };
    
    // Default for N/A or Early Season
    return { textClass: 'text-gray-700', bgClass: 'bg-gray-200' };
}

/**
 * Renders the multi-day danger ratings in a responsive table.
 * @param {Array} dailyRatings
 * @returns {string} HTML string
 */
function renderDangerRatings(dailyRatings) {
    if (dailyRatings.length === 0) {
        return `<p class="text-gray-500 italic">No multi-day danger ratings available.</p>`;
    }

    const header = dailyRatings.map(day => `
        <th class="p-4 text-center text-sm font-semibold border-b border-gray-300 bg-gray-50">${day.dateDisplay}</th>
    `).join('');

    // Function to generate the HTML for a specific elevation row
    const renderElevationRow = (elevationKey, label) => {
        const ratings = dailyRatings.map(day => {
            const rating = day[elevationKey];
            const { textClass, bgClass } = getRatingColorStyles(rating);
            return `
                <td class="p-2 sm:p-4 text-center text-sm border-b border-gray-200">
                    <span class="inline-block px-3 py-1 rounded-full text-xs font-bold ${textClass} ${bgClass}">
                        ${rating}
                    </span>
                </td>
            `;
        }).join('');
        
        return `
            <tr>
                <th class="p-2 sm:p-4 text-left font-semibold text-gray-700 bg-gray-50 border-r border-gray-200">${label}</th>
                ${ratings}
            </tr>
        `;
    };

    return `
        <div class="overflow-x-auto shadow-lg rounded-lg mb-8">
            <table class="min-w-full divide-y divide-gray-200">
                <thead class="bg-gray-100">
                    <tr>
                        <th class="p-4 text-left text-sm font-semibold text-gray-700 border-b border-gray-300 border-r">Elevation</th>
                        ${header}
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-100">
                    ${renderElevationRow('dangerAlpine', 'Alpine (Above Treeline)')}
                    ${renderElevationRow('dangerTreeline', 'Treeline')}
                    ${renderElevationRow('dangerBelowTreeline', 'Below Treeline')}
                </tbody>
            </table>
        </div>
    `;
}

/**
 * Renders the detailed avalanche problems in collapsible cards.
 * @param {Array} problems
 * @returns {string} HTML string
 */
function renderAvalancheProblems(problems) {
    if (problems.length === 0) {
        return `<p class="text-gray-500 italic">No specific avalanche problems are currently reported.</p>`;
    }

    const problemCards = problems.map((problem, index) => {
        return `
            <div class="problem-card bg-white p-6 rounded-xl shadow-md border border-gray-100 mb-4">
                <h4 class="text-xl font-bold mb-3 text-red-700">${problem.type}</h4>
                <p class="text-gray-700 mb-4 text-sm">${problem.comment}</p>
                
                <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm border-t pt-3">
                    <div class="p-2 bg-red-50 rounded-lg"><p class="font-medium text-gray-600">Likelihood</p><p class="font-bold">${problem.likelihood}</p></div>
                    <div class="p-2 bg-red-50 rounded-lg"><p class="font-medium text-gray-600">Expected Size</p><p class="font-bold">${problem.expectedSize}</p></div>
                    <div class="p-2 bg-red-50 rounded-lg"><p class="font-medium text-gray-600">Elevations</p><p class="font-bold">${problem.elevation || 'All Levels'}</p></div>
                    <div class="p-2 bg-red-50 rounded-lg"><p class="font-medium text-gray-600">Aspects</p><p class="font-bold">${problem.aspect || 'All Aspects'}</p></div>
                </div>
            </div>
        `;
    }).join('');

    return `
        <div class="mt-6">
            ${problemCards}
        </div>
    `;
}

/**
 * Renders the terrain and travel advice.
 * @param {Array} adviceList
 * @returns {string} HTML string
 */
function renderTerrainAdvice(adviceList) {
    if (adviceList.length === 0) {
        return `<p class="text-gray-500 italic">No specific terrain and travel advice provided.</p>`;
    }
    
    const listItems = adviceList.map(item => `
        <li class="flex items-start mb-2">
            <svg class="w-5 h-5 text-blue-600 flex-shrink-0 mr-2 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
            <span class="text-gray-700">${item}</span>
        </li>
    `).join('');

    return `<ul class="list-none p-0 my-4">${listItems}</ul>`;
}


/**
 * Renders the cleaned data to the DOM.
 * This is the first step of rendering, showing the user the raw forecast.
 * @param {Object} cleanedData - The object containing all cleaned forecast details.
 */
function renderCleanedData(cleanedData) {
    
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

    // --- 1. Render Report Metadata ---
    const metadata = cleanedData.reportMetadata;
    const issuedDate = metadata.dateIssued ? new Date(metadata.dateIssued).toLocaleDateString() : 'N/A';
    const validUntilDate = metadata.validUntil ? new Date(metadata.validUntil).toLocaleDateString() : 'N/A';

    const metadataHtml = `
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm mb-6 bg-gray-100 p-4 rounded-xl shadow-inner">
            <div class="p-1"><p class="font-medium text-gray-600">Forecaster</p><p class="font-bold text-lg">${metadata.forecaster}</p></div>
            <div class="p-1"><p class="font-medium text-gray-600">Confidence</p><p class="font-bold text-lg">${metadata.confidence}</p></div>
            <div class="p-1"><p class="font-medium text-gray-600">Issued</p><p>${issuedDate}</p></div>
            <div class="p-1"><p class="font-medium text-gray-600">Valid Until</p><p>${validUntilDate}</p></div>
        </div>
    `;

    // --- 2. Assemble All Sections ---
    const dataOutputHtml = `
        <h2 class="text-2xl font-bold mb-6 text-gray-800">Forecast Details</h2>
        
        ${metadataHtml}
        
        <!-- Danger Ratings Table -->
        <h3 class="text-xl font-semibold mb-3 pt-4 border-t-2 border-primary-500">Multi-Day Danger Ratings</h3>
        ${renderDangerRatings(cleanedData.dailyRatings)}

        <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <!-- Overall Summary Card -->
            <div class="bg-blue-50 p-5 rounded-xl border border-blue-200 shadow-sm">
                <h4 class="text-lg font-bold mb-2 text-blue-700">Overall Summary</h4>
                <p class="text-gray-700 text-sm">${cleanedData.summary}</p>
            </div>
            
            <!-- Weather Summary Card -->
            <div class="bg-gray-50 p-5 rounded-xl border border-gray-200 shadow-sm">
                <h4 class="text-lg font-bold mb-2 text-gray-700">Weather Summary</h4>
                <p class="text-gray-700 text-sm">${cleanedData.weatherSummary}</p>
            </div>
        </div>

        <!-- Avalanche Problems -->
        <h3 class="text-xl font-semibold mb-3 pt-4 border-t-2 border-red-500">Active Avalanche Problems (${cleanedData.avalancheProblems.length})</h3>
        ${renderAvalancheProblems(cleanedData.avalancheProblems)}

        <!-- Terrain & Travel Advice -->
        <h3 class="text-xl font-semibold mb-3 pt-4 border-t-2 border-green-500">Terrain & Travel Advice</h3>
        <div class="bg-green-50 p-5 rounded-xl border border-green-200 shadow-sm">
            ${renderTerrainAdvice(cleanedData.terrainAdvice)}
        </div>
    `;

    if (dataContainer) {
        dataContainer.innerHTML = dataOutputHtml;
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
            .replace(/\*\*(.*?)\*\*/g, '<strong class="text-red-700 font-extrabold">$1</strong>')
            .split('\n')
            .map(p => p.trim() ? `<p class="mb-3">${p}</p>` : '')
            .join('');

        llmContainer.innerHTML = `
            <h2 class="text-3xl font-bold mb-4 text-blue-800 border-b pb-2">Whistler Safety Briefing</h2>
            <div class="llm-summary-card bg-white p-6 rounded-xl shadow-lg border border-blue-100 text-gray-800">
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
        
        // Ensure the loading state is visible again for the LLM call
        document.getElementById('loading-state').classList.remove('hidden');

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