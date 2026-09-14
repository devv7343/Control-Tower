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

export default function ForecastChart({ facilityId = 5, medicineId = 1, onMedicineChange }) {
    const [chartData, setChartData] = useState([]);
    const [metadata, setMetadata] = useState({ facility_name: 'Clinic A1', medicine_name: 'Amoxicillin 500mg' });
    const [currentMedId, setCurrentMedId] = useState(medicineId);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (medicineId) setCurrentMedId(medicineId);
    }, [medicineId]);

    useEffect(() => {
        setIsLoading(true);
        getForecast(facilityId, currentMedId)
            .then(res => {
                if (res.detail) {
                    setError(res.detail);
                    setChartData([]);
                } else if (res.forecast) {
                    const formattedData = res.forecast.map(day => ({
                        ...day,
                        displayDate: day.date.substring(5),
                        confidenceRange: [day.confidence_lower, day.confidence_upper]
                    }));
                    setChartData(formattedData);
                    setMetadata({
                        facility_name: res.facility_name,
                        medicine_name: res.medicine_name
                    });
                    setError(null);
                }
            })
            .catch(() => setError('Failed to load forecast data.'))
            .finally(() => setIsLoading(false));
    }, [facilityId, currentMedId]);

    const handleMedChange = (newId) => {
        setCurrentMedId(newId);
        if (onMedicineChange) onMedicineChange(newId);
    };

    return (
        <div style={{
            border: '1px solid #e2e8f0',
            padding: '18px 20px',
            borderRadius: '12px',
            backgroundColor: '#ffffff',
            height: '100%',
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 1px 3px rgba(0,0,0,0.02)'
        }}>
            {/* Header with Title and Medicine Selector */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                <div>
                    <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>
                        7-Day Inventory ML Forecast
                    </h3>
                    <p style={{ margin: '2px 0 0 0', fontSize: '11px', color: '#64748b' }}>
                        {metadata.facility_name} &bull; XGBoost prediction with 95% confidence bands
                    </p>
                </div>

                <div style={{ display: 'flex', gap: '6px' }}>
                    {MEDICINES.map(m => (
                        <button
                            key={m.id}
                            onClick={() => handleMedChange(m.id)}
                            style={{
                                fontSize: '11px',
                                fontWeight: 600,
                                padding: '4px 8px',
                                borderRadius: '6px',
                                border: '1px solid',
                                borderColor: currentMedId === m.id ? '#2563eb' : '#cbd5e1',
                                backgroundColor: currentMedId === m.id ? '#eff6ff' : '#ffffff',
                                color: currentMedId === m.id ? '#2563eb' : '#475569',
                                cursor: 'pointer'
                            }}
                        >
                            {m.name.split(' ')[0]}
                        </button>
                    ))}
                </div>
            </div>

            {isLoading ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: '12px' }}>
                    Loading forecast model outputs...
                </div>
            ) : error ? (
                <div style={{ padding: '16px', borderRadius: '8px', backgroundColor: '#fef2f2', color: '#b91c1c', fontSize: '12px' }}>
                    {error}
                </div>
            ) : (
                <div style={{ flex: 1, width: '100%', minHeight: '260px' }}>
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
                                contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                                labelStyle={{ fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}
                            />
                            <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />

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