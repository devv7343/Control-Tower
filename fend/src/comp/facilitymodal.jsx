import React, { useState, useEffect } from 'react';
import { getCandidates, createTransfer, respondToTransfer } from '../api';

export default function FacilityModal({ facility, onClose, onTransferRouted }) {
    if (!facility) return null;

    const [selectedMed, setSelectedMed] = useState(null);
    const [selectedCandidate, setSelectedCandidate] = useState(null);
    const [candidates, setCandidates] = useState([]);
    const [isLoadingCandidates, setIsLoadingCandidates] = useState(false);
    const [isRouting, setIsRouting] = useState(false);
    const [message, setMessage] = useState(null);

    // Fetch candidates for selected medicine
    useEffect(() => {
        if (!facility?.id || !selectedMed?.medicine_id) {
            setCandidates([]);
            setSelectedCandidate(null);
            return;
        }

        if (selectedMed.status === 'surplus') {
            setCandidates([]);
            setSelectedCandidate(null);
            return;
        }

        setIsLoadingCandidates(true);
        getCandidates(facility.id, selectedMed.medicine_id)
            .then(res => {
                setCandidates(res || []);
            })
            .catch(err => {
                console.error("Failed to load candidates:", err);
                setCandidates([]);
            })
            .finally(() => {
                setIsLoadingCandidates(false);
            });
    }, [facility?.id, selectedMed?.medicine_id, selectedMed?.status]);

    const handleSelectMed = (med) => {
        setSelectedMed(med);
        setSelectedCandidate(null);
        setMessage(null);
    };

    const handleSelectCandidate = (cand) => {
        setSelectedCandidate(cand);
    };

    const handleAcceptAndRoute = async () => {
        if (!selectedMed || !selectedCandidate) return;

        setIsRouting(true);
        try {
            const medCap = selectedMed.capacity || 100;
            const neededQty = Math.max(10, Math.round(medCap * 0.7 - selectedMed.current_stock));

            // Create transfer
            const transfer = await createTransfer({
                requesting_facility_id: facility.id,
                medicine_id: selectedMed.medicine_id,
                quantity_requested: neededQty,
                priority: selectedMed.status === 'critical' ? 'critical' : 'warning'
            });

            // If match is proposed, immediately accept it to establish route
            if (transfer.matches && transfer.matches.length > 0) {
                const matchId = transfer.matches[0].id;
                await respondToTransfer(transfer.id, matchId, 'accept', transfer.matches[0].quantity_offered);
            }

            setMessage({ type: 'success', text: `Route dispatched from ${selectedCandidate.sourceName}! Supply is now In Transit.` });
            if (onTransferRouted) onTransferRouted();

            setTimeout(() => {
                onClose();
            }, 1200);
        } catch (err) {
            setMessage({ type: 'error', text: 'Failed to dispatch route: ' + err.message });
        } finally {
            setIsRouting(false);
        }
    };

    const getStatusColor = (status) => {
        if (status === 'critical') return '#ef4444';
        if (status === 'warning') return '#f59e0b';
        return '#22c55e';
    };

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            backgroundColor: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999
        }}>
            <div style={{
                backgroundColor: '#ffffff',
                width: '850px',
                maxWidth: '94vw',
                height: '560px',
                maxHeight: '90vh',
                borderRadius: '16px',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                border: '1px solid #e2e8f0'
            }}>
                {/* Modal Header */}
                <div style={{
                    padding: '18px 24px',
                    borderBottom: '1px solid #e2e8f0',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    backgroundColor: '#f8fafc'
                }}>
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>
                                {facility.name}
                            </h2>
                            <span style={{
                                fontSize: '11px',
                                textTransform: 'uppercase',
                                fontWeight: 700,
                                padding: '3px 8px',
                                borderRadius: '12px',
                                backgroundColor: facility.type === 'distributor' ? '#ede9fe' : facility.type === 'hospital' ? '#e0f2fe' : '#f1f5f9',
                                color: facility.type === 'distributor' ? '#6d28d9' : facility.type === 'hospital' ? '#0369a1' : '#475569'
                            }}>
                                {facility.type}
                            </span>
                        </div>
                        <p style={{ margin: '3px 0 0 0', fontSize: '12px', color: '#64748b' }}>
                            Coordinates: [{facility.geometry.coordinates[1].toFixed(3)}, {facility.geometry.coordinates[0].toFixed(3)}] &bull; Overall Status: <strong style={{ color: getStatusColor(facility.worst_status) }}>{facility.worst_status}</strong>
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        style={{
                            border: 'none',
                            background: '#f1f5f9',
                            width: '32px',
                            height: '32px',
                            borderRadius: '50%',
                            fontSize: '18px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#475569'
                        }}
                    >
                        &times;
                    </button>
                </div>

                {/* Modal Body */}
                <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                    {/* Left Column: Inventory List */}
                    <div style={{ flex: '1 1 50%', borderRight: '1px solid #e2e8f0', padding: '20px', overflowY: 'auto' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                            <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#334155' }}>
                                Live Facility Inventory
                            </h3>
                            <span style={{ fontSize: '11px', color: '#64748b' }}>Click to view supply routes</span>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            {facility.medicines.map(med => {
                                const medCap = med.capacity || facility.capacity || 100;
                                const fillPercent = Math.min(100, Math.max(5, Math.round((med.current_stock / medCap) * 100)));
                                const isSelected = selectedMed?.medicine_id === med.medicine_id;
                                const isNeed = med.status !== 'surplus';
                                const neededUnits = isNeed ? Math.max(10, Math.round(medCap * 0.7 - med.current_stock)) : 0;

                                return (
                                    <div
                                        key={med.medicine_id}
                                        onClick={() => handleSelectMed(med)}
                                        style={{
                                            padding: '12px',
                                            borderRadius: '10px',
                                            border: isSelected ? '2px solid #2563eb' : '1px solid #e2e8f0',
                                            backgroundColor: isSelected ? '#eff6ff' : '#ffffff',
                                            cursor: 'pointer',
                                            transition: 'all 0.15s ease'
                                        }}
                                    >
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                                            <strong style={{ fontSize: '13px', color: '#1e293b' }}>{med.medicine_name}</strong>
                                            {isNeed ? (
                                                <span style={{
                                                    fontSize: '11px',
                                                    fontWeight: 600,
                                                    color: med.status === 'critical' ? '#dc2626' : '#d97706',
                                                    backgroundColor: med.status === 'critical' ? '#fee2e2' : '#fef3c7',
                                                    padding: '2px 6px',
                                                    borderRadius: '6px'
                                                }}>
                                                    {neededUnits} needed
                                                </span>
                                            ) : (
                                                <span style={{ fontSize: '11px', color: '#16a34a', fontWeight: 600 }}>Surplus OK</span>
                                            )}
                                        </div>

                                        <div style={{
                                            width: '100%',
                                            height: '8px',
                                            backgroundColor: '#e2e8f0',
                                            borderRadius: '4px',
                                            overflow: 'hidden',
                                            marginBottom: '6px'
                                        }}>
                                            <div style={{
                                                width: `${fillPercent}%`,
                                                height: '100%',
                                                backgroundColor: getStatusColor(med.status),
                                                borderRadius: '4px',
                                                transition: 'width 0.3s ease'
                                            }} />
                                        </div>

                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#64748b' }}>
                                            <span>Stock: {Math.round(med.current_stock)} {med.capacity ? `/ ${Math.round(med.capacity)}` : ''}</span>
                                            {med.avg_daily_consumption !== undefined && med.avg_daily_consumption !== null ? (
                                                <span>Avg Daily: {Number(med.avg_daily_consumption).toFixed(2)}/day</span>
                                            ) : (
                                                <span>Status: {med.status}</span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Right Column: Routing & Suggestions */}
                    <div style={{ flex: '1 1 50%', padding: '20px', backgroundColor: '#fafbfc', display: 'flex', flexDirection: 'column' }}>
                        <h3 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: 600, color: '#334155' }}>
                            Optimized Supply Route Suggestions
                        </h3>

                        {message && (
                            <div style={{
                                padding: '10px 14px',
                                borderRadius: '8px',
                                fontSize: '12px',
                                marginBottom: '10px',
                                backgroundColor: message.type === 'success' ? '#dcfce7' : '#fee2e2',
                                color: message.type === 'success' ? '#15803d' : '#b91c1c'
                            }}>
                                {message.text}
                            </div>
                        )}

                        {!selectedMed ? (
                            <div style={{
                                flex: 1,
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: '#94a3b8',
                                textAlign: 'center',
                                padding: '20px'
                            }}>
                                <span style={{ fontSize: '32px', marginBottom: '8px' }}>📦</span>
                                <p style={{ fontSize: '13px', margin: 0 }}>
                                    Select any medicine from the left to view routing options and available surplus across the network.
                                </p>
                            </div>
                        ) : selectedMed.status === 'surplus' ? (
                            <div style={{
                                flex: 1,
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: '#16a34a',
                                textAlign: 'center',
                                padding: '20px'
                            }}>
                                <span style={{ fontSize: '32px', marginBottom: '8px' }}>✅</span>
                                <p style={{ fontSize: '13px', fontWeight: 600, margin: 0 }}>
                                    Supply is sufficient for {selectedMed.medicine_name}.
                                </p>
                                <span style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
                                    No transfers needed at this time.
                                </span>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflowY: 'auto' }}>
                                <p style={{ fontSize: '12px', color: '#64748b', margin: '0 0 10px 0' }}>
                                    Suppliers with verified surplus for <strong>{selectedMed.medicine_name}</strong>:
                                </p>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1, overflowY: 'auto', marginBottom: '14px' }}>
                                    {isLoadingCandidates ? (
                                        <div style={{ textAlign: 'center', padding: '24px', color: '#64748b', fontSize: '13px' }}>
                                            Checking network surplus &amp; optimal routes...
                                        </div>
                                    ) : candidates.length === 0 ? (
                                        <div style={{ textAlign: 'center', padding: '24px', color: '#94a3b8', fontSize: '13px' }}>
                                            No suppliers with available surplus found nearby.
                                        </div>
                                    ) : (
                                        candidates.map((cand) => {
                                            const isSelected = selectedCandidate?.sourceId === cand.sourceId;
                                            return (
                                                <div
                                                    key={cand.sourceId}
                                                    onClick={() => handleSelectCandidate(cand)}
                                                    style={{
                                                        backgroundColor: isSelected ? '#f0fdf4' : '#ffffff',
                                                        border: isSelected ? '2px solid #16a34a' : '1px solid #e2e8f0',
                                                        borderRadius: '10px',
                                                        padding: '12px 14px',
                                                        cursor: 'pointer',
                                                        display: 'flex',
                                                        justifyContent: 'space-between',
                                                        alignItems: 'center',
                                                        transition: 'all 0.15s ease'
                                                    }}
                                                >
                                                    <div>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                            <strong style={{ fontSize: '13px', color: '#0f172a' }}>{cand.sourceName}</strong>
                                                            <span style={{
                                                                fontSize: '10px',
                                                                padding: '2px 6px',
                                                                borderRadius: '4px',
                                                                backgroundColor: '#e2e8f0',
                                                                color: '#334155',
                                                                fontWeight: 600
                                                            }}>
                                                                {cand.relation || 'Network Supplier'}
                                                            </span>
                                                        </div>
                                                        <div style={{ fontSize: '11px', color: '#16a34a', marginTop: '3px' }}>
                                                            Surplus Available: <strong>{Math.round(cand.availableStock)} units</strong> &bull; {cand.distance} km away
                                                        </div>
                                                    </div>
                                                    <div style={{ textAlign: 'right' }}>
                                                        <span style={{ fontSize: '12px', fontWeight: 700, color: '#2563eb' }}>
                                                            {cand.time || (cand.transitMinutes ? `${cand.transitMinutes} mins` : '')}
                                                        </span>
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>

                                <button
                                    onClick={handleAcceptAndRoute}
                                    disabled={!selectedCandidate || isRouting}
                                    style={{
                                        padding: '12px 16px',
                                        backgroundColor: selectedCandidate ? '#2563eb' : '#cbd5e1',
                                        color: '#ffffff',
                                        border: 'none',
                                        borderRadius: '8px',
                                        fontWeight: 600,
                                        fontSize: '13px',
                                        cursor: selectedCandidate ? 'pointer' : 'not-allowed',
                                        transition: 'background 0.2s'
                                    }}
                                >
                                    {isRouting ? 'Dispatching Route...' : selectedCandidate ? `Accept & Route Supply from ${selectedCandidate.sourceName}` : 'Select a Supplier to Route'}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
