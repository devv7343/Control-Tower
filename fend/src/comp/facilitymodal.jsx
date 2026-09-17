/**
 * facilitymodal.jsx
 * Displays a detailed modal for a specific facility, showing its live inventory status
 * and offering supply routing options to address any shortages.
 */
import React, { useState, useEffect } from 'react';
import { getCandidates, createTransfer, respondToTransfer } from '../api';

const STYLES = {
    overlay: {
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
    },
    modal: {
        backgroundColor: '#ffffff',
        width: '850px',
        maxWidth: '94vw',
        height: '660px',
        maxHeight: '95vh',
        borderRadius: '16px',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        border: '1px solid #e2e8f0'
    },
    header: {
        padding: '18px 24px',
        borderBottom: '1px solid #e2e8f0',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: '#f8fafc'
    },
    headerTitleContainer: { display: 'flex', alignItems: 'center', gap: '10px' },
    headerTitle: { margin: 0, fontSize: '18px', fontWeight: 700, color: '#0f172a' },
    getFacilityTypeBadge: (type) => ({
        fontSize: '11px',
        textTransform: 'uppercase',
        fontWeight: 700,
        padding: '3px 8px',
        borderRadius: '12px',
        backgroundColor: type === 'distributor' ? '#ede9fe' : type === 'hospital' ? '#e0f2fe' : '#f1f5f9',
        color: type === 'distributor' ? '#6d28d9' : type === 'hospital' ? '#0369a1' : '#475569'
    }),
    headerSubtitle: { margin: '3px 0 0 0', fontSize: '12px', color: '#64748b' },
    closeButton: {
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
    },
    body: { display: 'flex', flex: 1, overflow: 'hidden' },
    leftCol: { flex: '1 1 50%', borderRight: '1px solid #e2e8f0', padding: '20px', overflowY: 'auto' },
    leftColHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' },
    leftColTitle: { margin: 0, fontSize: '14px', fontWeight: 600, color: '#334155' },
    medicineList: { display: 'flex', flexDirection: 'column', gap: '10px' },
    getMedicineItemStyle: (isSelected) => ({
        padding: '12px',
        borderRadius: '10px',
        border: isSelected ? '2px solid #2563eb' : '1px solid #e2e8f0',
        backgroundColor: isSelected ? '#eff6ff' : '#ffffff',
        cursor: 'pointer',
        transition: 'all 0.15s ease'
    }),
    medicineItemHeader: { display: 'flex', justifyContent: 'space-between', marginBottom: '6px' },
    medicineItemTitle: { fontSize: '13px', color: '#1e293b' },
    getNeedBadgeStyle: (status) => ({
        fontSize: '11px',
        fontWeight: 600,
        color: status === 'critical' ? '#dc2626' : (status === 'in_route' ? '#047857' : '#d97706'),
        backgroundColor: status === 'critical' ? '#fee2e2' : (status === 'in_route' ? '#d1fae5' : '#fef3c7'),
        padding: '2px 6px',
        borderRadius: '6px'
    }),
    surplusBadge: { fontSize: '11px', color: '#16a34a', fontWeight: 600 },
    progressBarContainer: {
        width: '100%',
        height: '8px',
        backgroundColor: '#e2e8f0',
        borderRadius: '4px',
        overflow: 'hidden',
        marginBottom: '6px'
    },
    medicineItemFooter: { display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#64748b' },
    rightCol: { flex: '1 1 50%', padding: '20px', backgroundColor: '#fafbfc', display: 'flex', flexDirection: 'column' },
    rightColTitle: { margin: '0 0 8px 0', fontSize: '14px', fontWeight: 600, color: '#334155' },
    getMessageStyle: (type) => ({
        padding: '10px 14px',
        borderRadius: '8px',
        fontSize: '12px',
        backgroundColor: type === 'success' ? '#dcfce7' : '#fee2e2',
        color: type === 'success' ? '#15803d' : '#b91c1c',
        animation: 'fadeIn 0.2s ease-in'
    }),
    emptyState: {
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#94a3b8',
        textAlign: 'center',
        padding: '20px'
    },
    surplusState: {
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#16a34a',
        textAlign: 'center',
        padding: '20px'
    },
    supplierListContainer: { display: 'flex', flexDirection: 'column', flex: 1, overflowY: 'auto' },
    supplierList: { display: 'flex', flexDirection: 'column', gap: '8px', flex: 1, overflowY: 'auto', marginBottom: '14px' },
    loadingCandidates: { textAlign: 'center', padding: '24px', color: '#64748b', fontSize: '13px' },
    noCandidates: { textAlign: 'center', padding: '24px', color: '#94a3b8', fontSize: '13px' },
    getCandidateStyle: (isSelected) => ({
        backgroundColor: isSelected ? '#f0fdf4' : '#ffffff',
        border: isSelected ? '2px solid #16a34a' : '1px solid #e2e8f0',
        borderRadius: '10px',
        padding: '10px 12px',
        cursor: 'pointer',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        transition: 'all 0.15s ease'
    }),
    candidateHeader: { display: 'flex', alignItems: 'center', gap: '6px' },
    candidateTitle: { fontSize: '13px', color: '#0f172a' },
    candidateBadge: {
        fontSize: '10px',
        padding: '2px 6px',
        borderRadius: '4px',
        backgroundColor: '#e2e8f0',
        color: '#334155',
        fontWeight: 600
    },
    candidateDetails: { fontSize: '11px', color: '#16a34a', marginTop: '3px' },
    candidateTime: { textAlign: 'right' },
    candidateTimeText: { fontSize: '12px', fontWeight: 700, color: '#2563eb' },
    routeButton: (disabled) => ({
        padding: '12px 16px',
        backgroundColor: !disabled ? '#2563eb' : '#cbd5e1',
        color: '#ffffff',
        border: 'none',
        borderRadius: '8px',
        fontWeight: 600,
        fontSize: '13px',
        cursor: !disabled ? 'pointer' : 'not-allowed',
        transition: 'background 0.2s'
    })
};

export default function FacilityModal({ facility, onClose, onTransferRouted }) {
    if (!facility) return null;

    const [selectedMedicine, setSelectedMedicine] = useState(null);
    const [selectedCandidate, setSelectedCandidate] = useState(null);
    const [candidates, setCandidates] = useState([]);
    const [isLoadingCandidates, setIsLoadingCandidates] = useState(false);
    const [isRouting, setIsRouting] = useState(false);
    const [message, setMessage] = useState(null);

    // Fetch supply candidates when a medicine with a shortage is selected
    useEffect(() => {
        if (!facility?.id || !selectedMedicine?.medicine_id) {
            setCandidates([]);
            setSelectedCandidate(null);
            return;
        }

        if (selectedMedicine.status === 'surplus') {
            setCandidates([]);
            setSelectedCandidate(null);
            return;
        }

        setIsLoadingCandidates(true);
        getCandidates(facility.id, selectedMedicine.medicine_id)
            .then(response => {
                setCandidates(response || []);
            })
            .catch(error => {
                console.error("Failed to load candidates:", error);
                setCandidates([]);
            })
            .finally(() => {
                setIsLoadingCandidates(false);
            });
    }, [facility?.id, selectedMedicine?.medicine_id, selectedMedicine?.status]);

    const handleSelectMedicine = (medicine) => {
        setSelectedMedicine(medicine);
        setSelectedCandidate(null);
        setMessage(null);
    };

    const handleSelectCandidate = (candidate) => {
        setSelectedCandidate(candidate);
    };

    /**
     * Accepts the selected candidate's supply offer and routes the supply to the facility.
     */
    const handleAcceptAndRoute = async () => {
        if (!selectedMedicine || !selectedCandidate) return;

        setIsRouting(true);
        try {
            const medicineCapacity = selectedMedicine.capacity || 100;
            const neededQuantity = Math.max(10, Math.round(medicineCapacity * 0.7 - selectedMedicine.current_stock));

            // Create transfer request
            const transfer = await createTransfer({
                requesting_facility_id: facility.id,
                medicine_id: selectedMedicine.medicine_id,
                quantity_requested: neededQuantity,
                priority: selectedMedicine.status === 'critical' ? 'critical' : 'warning'
            });

            setMessage({ type: 'success', text: `Supply request created! It is now pending approval in the Manage Transfers tab.` });
            if (onTransferRouted) onTransferRouted();

            setTimeout(() => {
                onClose();
            }, 2000);
        } catch (error) {
            setMessage({ type: 'error', text: 'Failed to dispatch route: ' + error.message });
        } finally {
            setIsRouting(false);
        }
    };

    const getStatusColor = (status) => {
        if (status === 'critical') return '#ef4444';
        if (status === 'warning') return '#f59e0b';
        if (status === 'in_route') return '#10b981';
        return '#22c55e';
    };

    return (
        <div style={STYLES.overlay}>
            <style>{`
                .hide-scrollbar::-webkit-scrollbar { display: none; }
                .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
            `}</style>
            <div style={STYLES.modal}>
                {/* Modal Header */}
                <div style={STYLES.header}>
                    <div>
                        <div style={STYLES.headerTitleContainer}>
                            <h2 style={STYLES.headerTitle}>
                                {facility.name}
                            </h2>
                            <span style={STYLES.getFacilityTypeBadge(facility.type)}>
                                {facility.type}
                            </span>
                        </div>
                        <p style={STYLES.headerSubtitle}>
                            Coordinates: [{facility.geometry.coordinates[1].toFixed(3)}, {facility.geometry.coordinates[0].toFixed(3)}] &bull; Overall Status: <strong style={{ color: getStatusColor(facility.worst_status), textTransform: 'capitalize' }}>{facility.worst_status === 'in_route' ? 'In Route' : facility.worst_status}</strong>
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        style={STYLES.closeButton}
                    >
                        &times;
                    </button>
                </div>

                {/* Modal Body */}
                <div style={STYLES.body}>
                    {/* Left Column: Inventory List */}
                    <div className="hide-scrollbar" style={STYLES.leftCol}>
                        <div style={STYLES.leftColHeader}>
                            <h3 style={STYLES.leftColTitle}>
                                Live Facility Inventory
                            </h3>
                            <span style={{ fontSize: '11px', color: '#64748b' }}>Click to view supply routes</span>
                        </div>

                        <div style={STYLES.medicineList}>
                            {facility.medicines.map(medicine => {
                                const medicineCapacity = medicine.capacity || facility.capacity || 100;
                                const fillPercent = Math.min(100, Math.max(5, Math.round((medicine.current_stock / medicineCapacity) * 100)));
                                const isSelected = selectedMedicine?.medicine_id === medicine.medicine_id;
                                const isNeed = medicine.status !== 'surplus';
                                const neededUnits = isNeed ? Math.max(10, Math.round(medicineCapacity * 0.7 - medicine.current_stock)) : 0;

                                return (
                                    <div
                                        key={medicine.medicine_id}
                                        onClick={() => handleSelectMedicine(medicine)}
                                        style={STYLES.getMedicineItemStyle(isSelected)}
                                    >
                                        <div style={STYLES.medicineItemHeader}>
                                            <strong style={STYLES.medicineItemTitle}>{medicine.medicine_name}</strong>
                                            {isNeed ? (
                                                <span style={STYLES.getNeedBadgeStyle(medicine.status)}>
                                                    {medicine.status === 'in_route' ? 'In Route' : `${neededUnits} needed`}
                                                </span>
                                            ) : (
                                                <span style={STYLES.surplusBadge}>Surplus OK</span>
                                            )}
                                        </div>

                                        <div style={STYLES.progressBarContainer}>
                                            <div style={{
                                                width: `${fillPercent}%`,
                                                height: '100%',
                                                backgroundColor: getStatusColor(medicine.status),
                                                borderRadius: '4px',
                                                transition: 'width 0.3s ease'
                                            }} />
                                        </div>

                                        <div style={STYLES.medicineItemFooter}>
                                            <span>Stock: {Math.round(medicine.current_stock)} {medicine.capacity ? `/ ${Math.round(medicine.capacity)}` : ''}</span>
                                            {medicine.avg_daily_consumption !== undefined && medicine.avg_daily_consumption !== null ? (
                                                <span>Avg Daily: {Number(medicine.avg_daily_consumption).toFixed(2)}/day</span>
                                            ) : (
                                                <span style={{ textTransform: 'capitalize' }}>Status: {medicine.status === 'in_route' ? 'In Route' : medicine.status}</span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Right Column: Routing & Suggestions */}
                    <div style={STYLES.rightCol}>
                        <h3 style={STYLES.rightColTitle}>
                            Optimized Supply Route Suggestions
                        </h3>

                        {/* Reserved space for messages to prevent layout shift and scrollbars */}
                        <div style={{ minHeight: '40px', marginBottom: '8px' }}>
                            {message && (
                                <div style={STYLES.getMessageStyle(message.type)}>
                                    {message.text}
                                </div>
                            )}
                        </div>

                        {!selectedMedicine ? (
                            <div style={STYLES.emptyState}>
                                <span style={{ fontSize: '32px', marginBottom: '8px' }}>📦</span>
                                <p style={{ fontSize: '13px', margin: 0 }}>
                                    Select any medicine from the left to view routing options and available surplus across the network.
                                </p>
                            </div>
                        ) : selectedMedicine.status === 'surplus' ? (
                            <div style={STYLES.surplusState}>
                                <span style={{ fontSize: '32px', marginBottom: '8px' }}>✅</span>
                                <p style={{ fontSize: '13px', fontWeight: 600, margin: 0 }}>
                                    Supply is sufficient for {selectedMedicine.medicine_name}.
                                </p>
                                <span style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
                                    No transfers needed at this time.
                                </span>
                            </div>
                        ) : (
                            <div style={STYLES.supplierListContainer}>
                                <p style={{ fontSize: '12px', color: '#64748b', margin: '0 0 10px 0' }}>
                                    Suppliers with verified surplus for <strong>{selectedMedicine.medicine_name}</strong>:
                                </p>

                                <div className="hide-scrollbar" style={STYLES.supplierList}>
                                    {isLoadingCandidates ? (
                                        <div style={STYLES.loadingCandidates}>
                                            Checking network surplus &amp; optimal routes...
                                        </div>
                                    ) : candidates.length === 0 ? (
                                        <div style={STYLES.noCandidates}>
                                            No suppliers with available surplus found nearby.
                                        </div>
                                    ) : (
                                        candidates.map((candidate) => {
                                            const isSelected = selectedCandidate?.sourceId === candidate.sourceId;
                                            return (
                                                <div
                                                    key={candidate.sourceId}
                                                    onClick={() => handleSelectCandidate(candidate)}
                                                    style={STYLES.getCandidateStyle(isSelected)}
                                                >
                                                    <div>
                                                        <div style={STYLES.candidateHeader}>
                                                            <strong style={STYLES.candidateTitle}>{candidate.sourceName}</strong>
                                                            <span style={STYLES.candidateBadge}>
                                                                {candidate.relation || 'Network Supplier'}
                                                            </span>
                                                        </div>
                                                        <div style={STYLES.candidateDetails}>
                                                            Surplus Available: <strong>{Math.round(candidate.availableStock)} units</strong> &bull; {candidate.distance} km away
                                                        </div>
                                                    </div>
                                                    <div style={STYLES.candidateTime}>
                                                        <span style={STYLES.candidateTimeText}>
                                                            {candidate.time || (candidate.transitMinutes ? `${candidate.transitMinutes} mins` : '')}
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
                                    style={STYLES.routeButton(!selectedCandidate || isRouting)}
                                >
                                    {isRouting ? 'Requesting...' : selectedCandidate ? `Request Supply from ${selectedCandidate.sourceName}` : 'Select a Supplier'}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
