import os
import requests
import re
import json # Used for structuring the prompt
# Import 'request' for handling POST data
from flask import Flask, render_template, jsonify, request
# Import load_dotenv and find_dotenv to robustly locate the .env file
from dotenv import load_dotenv, find_dotenv

# Load environment variables from .env file (find_dotenv searches parent directories)
# This ensures it finds the .env file located at the project root.
load_dotenv(find_dotenv())

# The external API URL is now hidden on the server-side
EXTERNAL_API_URL = 'https://api.avalanche.ca/forecasts/en/products/point?lat=50.11367&long=-122.95477'
GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent'

# Initialize Flask app, setting template and static folders to 'frontend'
app = Flask(__name__, template_folder='../frontend', static_folder='../frontend')

# --- Utility Functions ---

def _process_raw_data(raw_data):
    """
    Cleans and extracts all relevant forecast data points, including multi-day ratings
    and report metadata, into a single structured object.
    """
    if not raw_data:
        return None

    current_forecast = raw_data
    # Handling list response from API where the first element is the target object
    if isinstance(raw_data, list) and raw_data:
        current_forecast = raw_data[0]
        
    report = current_forecast.get('report')
    if not report:
        return None

    # 1. Report Metadata (Ensuring missing dates are None, which JS handles defensively)
    report_metadata = {
        'forecaster': report.get('forecaster', 'N/A'),
        'dateIssued': report.get('dateIssued', None), 
        'validUntil': report.get('validUntil', None), 
        'confidence': report.get('confidence', {}).get('rating', {}).get('display', 'N/A')
    }

    # 2. Area Name
    area_name = current_forecast.get('area', {}).get('name', 'Avalanche Area')

    # 3. Summary (clean HTML from highlights)
    highlights_html = report.get('highlights', 'No summary provided.')
    summary_text = re.sub('<[^<]+?>', '', highlights_html).strip() 
    
    # 4. Daily Danger Ratings (Array of up to 3 days)
    daily_ratings = []
    
    for day_data in report.get('dangerRatings', []):
        # We access 'display' which should be a string, or 'N/A' default
        forecast_date = day_data.get('date', {}).get('display', 'N/A')
        ratings = day_data.get('ratings', {})
        
        def get_rating_display(key, default='N/A'):
            return ratings.get(key, {}).get('rating', {}).get('display', default)

        daily_ratings.append({
            'dateDisplay': forecast_date,
            'dangerAlpine': get_rating_display('alp'),
            'dangerTreeline': get_rating_display('tln'),
            'dangerBelowTreeline': get_rating_display('btl'),
        })

    # Compile the final cleaned data object
    cleaned_data = {
        'reportMetadata': report_metadata,
        'summary': summary_text,
        'areaName': area_name,
        'dailyRatings': daily_ratings
    }

    return cleaned_data

def _make_gemini_call(cleaned_data):
    """Calls the Gemini API from the backend and returns the safety briefing."""
    
    user_query = f"""You are a professional avalanche forecaster. Provide a concise, three-paragraph safety briefing for the forecast area.
1. The first paragraph must summarize the overall **current** risk and mention the **Forecaster** and their **Confidence**.
2. The second paragraph must recommend specific travel safety measures based on the danger levels for the **first day**.
3. The third paragraph must comment on the outlook or change in danger for the **subsequent days**, mentioning the primary dangers for days 2 and 3 if they differ significantly from day 1.

Here is the cleaned, multi-day data: {json.dumps(cleaned_data)}"""
    
    system_prompt = "Act as a highly experienced, safety-focused mountain guide and avalanche forecaster. Your response must be authoritative, easy to understand, and contain only the generated briefing text, no introductions or concluding remarks. Use markdown formatting for emphasis (e.g., **HIGH**)."

    payload = {
        'contents': [{'parts': [{'text': user_query}]}],
        'systemInstruction': {'parts': [{'text': system_prompt}]}
    }

    try:
        # Check environment variables (loaded by load_dotenv)
        api_key = os.environ.get('GEMINI_API_KEY')
        
        api_url_with_key = GEMINI_API_URL
        if api_key:
            api_url_with_key += f"?key={api_key}"
        else:
            # Error message now directs user to the .env file
            return "Error: GEMINI_API_KEY not found. Please ensure it is set correctly in your '.env' file at the project root."
        
        response = requests.post(
            api_url_with_key,
            headers={'Content-Type': 'application/json'},
            data=json.dumps(payload)
        )
        response.raise_for_status()
        
        result = response.json()
        generated_text = result.get('candidates', [{}])[0].get('content', {}).get('parts', [{}])[0].get('text', 'LLM generation failed.')
        return generated_text

    except requests.exceptions.RequestException as e:
        # Log and return the error status code for clarity
        status_code = response.status_code if 'response' in locals() else 'N/A'
        print(f"Error calling Gemini API: {e} (Status: {status_code})")
        return f"Error: Failed to generate summary from LLM ({status_code} - {e}). Check the API key and ensure the Generative Language API is enabled."


# --- Flask Routes ---
@app.route('/')
def index():
    """
    Renders the main page (frontend/index.html).
    """
    return render_template('index.html')
       
@app.route('/api/avdata', methods=['GET'])
def get_cleaned_avdata():
    """
    ENDPOINT 1: Fetches raw data from the external API, processes it, and returns
    only the cleaned forecast data for immediate display on the frontend.
    """
    try:
        # 1. Fetch data from external API
        response = requests.get(EXTERNAL_API_URL)
        response.raise_for_status()
        raw_json = response.json()
        data_to_process = raw_json[0] if isinstance(raw_json, list) and raw_json else raw_json

        # 2. Clean and process data
        cleaned_data = _process_raw_data(data_to_process)
        if not cleaned_data:
            return jsonify({"error": "No usable forecast data was found for this location or date."}), 404

        # 3. Return cleaned data only
        return jsonify({'cleanedData': cleaned_data})
        
    except requests.exceptions.RequestException as e:
        print(f"Error fetching data from external API: {e}")
        return jsonify({"error": f"Could not retrieve external forecast data: {e}"}), 500

@app.route('/api/llmsummary', methods=['POST'])
def get_llm_summary():
    """
    ENDPOINT 2: Receives cleaned data from the frontend via POST, calls Gemini, and returns the LLM summary.
    """
    try:
        # Get cleaned data sent from the frontend
        data = request.get_json()
        cleaned_data = data.get('cleanedData')

        if not cleaned_data:
            return jsonify({"error": "Missing cleanedData payload for LLM generation."}), 400

        # 1. Call Gemini LLM with cleaned data
        llm_summary = _make_gemini_call(cleaned_data)
        
        # 2. Return LLM summary
        return jsonify({'llmSummary': llm_summary})

    except Exception as e:
        # Log and return the error. This catches issues like invalid JSON payload.
        print(f"Error processing LLM summary request: {e}")
        return jsonify({"error": f"Failed to generate LLM summary due to server error: {e}"}), 500


if __name__ == '__main__':
    print("--- Starting Flask Server ---")
    app.run(debug=True)