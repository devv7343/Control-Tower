/**
 * forecastchart.jsx
 * Displays a 7-day inventory machine learning forecast for a selected facility and medicine.
 * Includes a confidence band for predicted stock levels using Recharts.
 */
import React, { useEffect, useState } from 'react';
import {
    ComposedChart,
    Line,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer
} from 'recharts';
import { getForecast, MEDICINES } from '../api';

const STYLES = {
    container: {
        border: '1px solid #e2e8f0',
        padding: '18px 20px',
        borderRadius: '12px',
        backgroundColor: '#ffffff',
        height: '100%',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 1px 3px rgba(0,0,0,0.02)'
    },
    headerContainer: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' },
    title: { margin: 0, fontSize: '14px', fontWeight: 700, color: '#0f172a' },
    subtitle: { margin: '2px 0 0 0', fontSize: '11px', color: '#64748b' },
    buttonGroup: { display: 'flex', gap: '6px' },
    getButtonStyle: (isActive) => ({
        fontSize: '11px',
        fontWeight: 600,
        padding: '4px 8px',
        borderRadius: '6px',
        border: '1px solid',
        borderColor: isActive ? '#2563eb' : '#cbd5e1',
        backgroundColor: isActive ? '#eff6ff' : '#ffffff',
        color: isActive ? '#2563eb' : '#475569',
        cursor: 'pointer'
    }),
    loading: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: '12px' },
    error: { padding: '16px', borderRadius: '8px', backgroundColor: '#fef2f2', color: '#b91c1c', fontSize: '12px' },
    chartWrapper: { flex: 1, width: '100%', minHeight: '260px' },
    tooltipStyle: { borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' },
    tooltipLabelStyle: { fontWeight: 700, color: '#0f172a', marginBottom: '4px' },
    legendWrapperStyle: { fontSize: '11px', paddingTop: '8px' }
};

export default function ForecastChart({ facilityId = 5, medicineId = 1, onMedicineChange }) {
    const [chartData, setChartData] = useState([]);
    const [metadata, setMetadata] = useState({ facility_name: 'Clinic A1', medicine_name: 'Amoxicillin 500mg' });
    const [currentMedicineId, setCurrentMedicineId] = useState(medicineId);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);

    // Sync state with props
    useEffect(() => {
        if (medicineId) {
            setCurrentMedicineId(medicineId);
        }
    }, [medicineId]);

    // Fetch the ML forecast for the selected facility and medicine
    useEffect(() => {
        setIsLoading(true);
        getForecast(facilityId, currentMedicineId)
            .then(response => {
                if (response.detail) {
                    setError(response.detail);
                    setChartData([]);
                } else if (response.forecast) {
                    const formattedData = response.forecast.map(day => ({
                        ...day,
                        displayDate: day.date.substring(5),
                        predicted_stock: Math.round(day.predicted_stock),
                        confidenceRange: [Math.round(day.confidence_lower), Math.round(day.confidence_upper)],
                        predicted_consumption: Number(Number(day.predicted_consumption).toFixed(2))
                    }));
                    setChartData(formattedData);
                    setMetadata({
                        facility_name: response.facility_name,
                        medicine_name: response.medicine_name
                    });
                    setError(null);
                }
            })
            .catch(() => setError('Failed to load forecast data.'))
            .finally(() => setIsLoading(false));
    }, [facilityId, currentMedicineId]);

    /**
     * Handles switching the active medicine tab.
     */
    const handleMedicineChange = (newMedicineId) => {
        setCurrentMedicineId(newMedicineId);
        if (onMedicineChange) {
            onMedicineChange(newMedicineId);
        }
    };

    return (
        <div style={STYLES.container}>
            {/* Header with Title and Medicine Selector */}
            <div style={STYLES.headerContainer}>
                <div>
                    <h3 style={STYLES.title}>
                        7-Day Inventory ML Forecast
                    </h3>
                    <p style={STYLES.subtitle}>
                        {metadata.facility_name} &bull; XGBoost prediction with 95% confidence bands
                    </p>
                </div>

                <div style={STYLES.buttonGroup}>
                    {MEDICINES.map(medicine => (
                        <button
                            key={medicine.id}
                            onClick={() => handleMedicineChange(medicine.id)}
                            style={STYLES.getButtonStyle(currentMedicineId === medicine.id)}
                        >
                            {medicine.name.split(' ')[0]}
                        </button>
                    ))}
                </div>
            </div>

            {isLoading ? (
                <div style={STYLES.loading}>
                    Loading forecast model outputs...
                </div>
            ) : error ? (
                <div style={STYLES.error}>
                    {error}
                </div>
            ) : (
                <div style={STYLES.chartWrapper}>
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart
                            data={chartData}
                            margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                        >
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                            <XAxis
                                dataKey="displayDate"
                                tick={{ fontSize: 11, fill: '#64748b' }}
                                axisLine={{ stroke: '#e2e8f0' }}
                                tickLine={false}
                            />
                            <YAxis
                                tick={{ fontSize: 11, fill: '#64748b' }}
                                axisLine={false}
                                tickLine={false}
                            />
                            <Tooltip
                                contentStyle={STYLES.tooltipStyle}
                                labelStyle={STYLES.tooltipLabelStyle}
                                formatter={(value, name) => {
                                    if (Array.isArray(value)) {
                                        return [`[${Math.round(value[0])}, ${Math.round(value[1])}] units`, name];
                                    }
                                    if (String(name).toLowerCase().includes('consumption')) {
                                        return [`${Number(value).toFixed(2)} units/day`, name];
                                    }
                                    return [`${Math.round(value)} units`, name];
                                }}
                            />
                            <Legend wrapperStyle={STYLES.legendWrapperStyle} />

                            {/* 95% Confidence Band */}
                            <Area
                                type="monotone"
                                dataKey="confidenceRange"
                                name="95% Confidence Interval"
                                stroke="none"
                                fill="#bfdbfe"
                                fillOpacity={0.45}
                            />

                            {/* Predicted Stock Line */}
                            <Line
                                type="monotone"
                                dataKey="predicted_stock"
                                name="Predicted Stock Level"
                                stroke="#2563eb"
                                strokeWidth={2.5}
                                dot={{ r: 3, strokeWidth: 2, fill: '#ffffff', stroke: '#2563eb' }}
                                activeDot={{ r: 5 }}
                            />
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>
            )}
        </div>
    );
}