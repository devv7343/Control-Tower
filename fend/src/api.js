/**
 * api.js - Control Tower Client Engine
 * Connects strictly to the API Contract defined backend
 */

const BASE_URL = '/api';

const updateListeners = new Set();

/**
 * Subscribe to network updates (e.g., when a transfer is created or resolved).
 * @param {Function} listener - Callback function to execute on update.
 * @returns {Function} Unsubscribe function.
 */
export const subscribeToNetworkUpdates = (listener) => {
    updateListeners.add(listener);
    return () => updateListeners.delete(listener);
};

/**
 * Emits an update event to all registered listeners.
 */
const emitUpdate = () => {
    updateListeners.forEach(callback => {
        try { 
            callback(); 
        } catch (error) { 
            console.error('Error in network update listener:', error); 
        }
    });
};

/**
 * Handles the HTTP response, throwing an error if the request failed.
 * @param {Response} response - The Fetch API response object.
 * @returns {Promise<any>} The parsed JSON data.
 */
const handleResponse = async (response) => {
    if (!response.ok) {
        let errorDetails;
        try { 
            errorDetails = await response.json(); 
        } catch (parseError) {
            // Ignore JSON parse errors for non-JSON error responses
        }
        throw new Error(errorDetails?.detail || `HTTP Error ${response.status}`);
    }
    return response.json();
};

/**
 * Fetches all facilities and their current inventory statuses.
 * @returns {Promise<Object>} GeoJSON FeatureCollection of facilities.
 */
export const getFacilities = async () => {
    const response = await fetch(`${BASE_URL}/facilities`);
    return handleResponse(response);
};

/**
 * Fetches a summary and detailed list of inventory across facilities.
 * @param {Object} [params={}] - Query parameters (e.g., facility_id, medicine_id, status).
 * @returns {Promise<Object>} Inventory summary and item list.
 */
export const getInventory = async (params = {}) => {
    const url = new URL(`${BASE_URL}/inventory`, window.location.origin);
    Object.keys(params).forEach(key => {
        if (params[key]) {
            url.searchParams.append(key, params[key]);
        }
    });
    const response = await fetch(url);
    return handleResponse(response);
};

/**
 * Generates an inventory forecast for a specific facility and medicine.
 * @param {number} facilityId - The ID of the facility.
 * @param {number} medicineId - The ID of the medicine.
 * @param {number} [horizon=7] - Forecast horizon in days.
 * @param {number} [leadTimeDays=5] - Resupply lead time.
 * @returns {Promise<Object>} Forecast predictions.
 */
export const getForecast = async (facilityId, medicineId, horizon = 7, leadTimeDays = 5) => {
    const response = await fetch(`${BASE_URL}/forecast?facility_id=${facilityId}&medicine_id=${medicineId}&horizon=${horizon}&lead_time_days=${leadTimeDays}`);
    return handleResponse(response);
};

/**
 * Calculates the suggested reorder quantity for a medicine at a facility.
 * @param {number} facilityId - The ID of the facility.
 * @param {number} medicineId - The ID of the medicine.
 * @returns {Promise<Object>} Suggested quantity response.
 */
export const getSuggestedQuantity = async (facilityId, medicineId) => {
    const response = await fetch(`${BASE_URL}/forecast/suggested-quantity?facility_id=${facilityId}&medicine_id=${medicineId}`);
    return handleResponse(response);
};

/**
 * Finds potential facilities that can supply a specific medicine.
 * @param {number} facilityId - The requesting facility ID.
 * @param {number} medicineId - The needed medicine ID.
 * @returns {Promise<Array<Object>>} List of candidate facilities.
 */
export const getCandidates = async (facilityId, medicineId) => {
    const response = await fetch(`${BASE_URL}/candidates?requesting_facility_id=${facilityId}&medicine_id=${medicineId}`);
    return handleResponse(response).then(data => data.candidates);
};

export const findSupplyCandidates = getCandidates;

/**
 * Lists transfer requests, optionally filtered by status or parent request.
 * @param {Object} [params={}] - Query parameters.
 * @returns {Promise<Object>} List of transfers.
 */
export const getTransfers = async (params = {}) => {
    const url = new URL(`${BASE_URL}/transfers`, window.location.origin);
    Object.keys(params).forEach(key => {
        if (params[key]) {
            url.searchParams.append(key, params[key]);
        }
    });
    const response = await fetch(url);
    return handleResponse(response);
};

/**
 * Initiates a transfer request for medicines between facilities.
 * @param {Object} payload - Transfer request payload.
 * @returns {Promise<Object>} The created transfer request.
 */
export const createTransfer = async (payload) => {
    const response = await fetch(`${BASE_URL}/transfers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const result = await handleResponse(response);
    emitUpdate();
    return result;
};

/**
 * Accepts or rejects a proposed transfer match.
 * @param {number} transferId - The ID of the transfer request.
 * @param {number} matchId - The ID of the match offer.
 * @param {string} action - 'accept' or 'reject'.
 * @param {number} [quantityOffered=null] - The quantity offered if accepted.
 * @returns {Promise<Object>} Updated transfer request.
 */
export const respondToTransfer = async (transferId, matchId, action, quantityOffered = null) => {
    const payload = { match_id: matchId, action };
    if (quantityOffered !== null) {
        payload.quantity_offered = quantityOffered;
    }
    const response = await fetch(`${BASE_URL}/transfers/${transferId}/respond`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const result = await handleResponse(response);
    emitUpdate();
    return result;
};

// Helper for UI
export const MEDICINES = [
    { id: 1, name: "ORS Sachets", category: "Rehydration", unit: "sachets", leadTime: 3 },
    { id: 2, name: "Amoxicillin 500mg", category: "Antibiotic", unit: "tablets", leadTime: 5 },
    { id: 3, name: "Paracetamol 500mg", category: "Analgesic", unit: "tablets", leadTime: 2 },
    { id: 4, name: "IV Fluids (Normal Saline)", category: "Fluids", unit: "bottles", leadTime: 4 },
    { id: 5, name: "Antiviral (Oseltamivir)", category: "Antiviral", unit: "capsules", leadTime: 7 }
];