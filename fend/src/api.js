// api.js - Control Tower Client Engine
// Connects strictly to the API Contract defined backend

const BASE_URL = 'http://localhost:8000';

const listeners = new Set();
export const subscribeToNetworkUpdates = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};
const emitUpdate = () => {
    listeners.forEach(cb => {
        try { cb(); } catch (e) { console.error(e); }
    });
};

const handleResponse = async (res) => {
    if (!res.ok) {
        let err;
        try { err = await res.json(); } catch (e) {}
        throw new Error(err?.detail || `HTTP Error ${res.status}`);
    }
    return res.json();
};

export const getFacilities = async () => {
    const res = await fetch(`${BASE_URL}/facilities`);
    return handleResponse(res);
};

export const getInventory = async (params = {}) => {
    const url = new URL(`${BASE_URL}/inventory`);
    Object.keys(params).forEach(k => {
        if (params[k]) url.searchParams.append(k, params[k]);
    });
    const res = await fetch(url);
    return handleResponse(res);
};

export const getForecast = async (facilityId, medicineId, horizon = 7, leadTimeDays = 5) => {
    const res = await fetch(`${BASE_URL}/forecast?facility_id=${facilityId}&medicine_id=${medicineId}&horizon=${horizon}&lead_time_days=${leadTimeDays}`);
    return handleResponse(res);
};

export const getSuggestedQuantity = async (facilityId, medicineId) => {
    const res = await fetch(`${BASE_URL}/forecast/suggested-quantity?facility_id=${facilityId}&medicine_id=${medicineId}`);
    return handleResponse(res);
};

export const getCandidates = async (facilityId, medicineId) => {
    const res = await fetch(`${BASE_URL}/candidates?requesting_facility_id=${facilityId}&medicine_id=${medicineId}`);
    return handleResponse(res).then(data => data.candidates);
};

export const findSupplyCandidates = getCandidates;

export const getTransfers = async (params = {}) => {
    const url = new URL(`${BASE_URL}/transfers`);
    Object.keys(params).forEach(k => {
        if (params[k]) url.searchParams.append(k, params[k]);
    });
    const res = await fetch(url);
    return handleResponse(res);
};

export const createTransfer = async (payload) => {
    const res = await fetch(`${BASE_URL}/transfers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const result = await handleResponse(res);
    emitUpdate();
    return result;
};

export const respondToTransfer = async (transferId, matchId, action, quantityOffered = null) => {
    const payload = { match_id: matchId, action };
    if (quantityOffered !== null) {
        payload.quantity_offered = quantityOffered;
    }
    const res = await fetch(`${BASE_URL}/transfers/${transferId}/respond`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const result = await handleResponse(res);
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