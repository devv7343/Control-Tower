/**
 * transferpanel.jsx
 * Provides a UI panel to manage existing supply transfers (accept/reject matches)
 * and request new supplies with ML-suggested quantities.
 */
import React, { useEffect, useState } from 'react';
import {
    getSuggestedQuantity,
    createTransfer,
    getTransfers,
    respondToTransfer,
    getFacilities,
    MEDICINES,
    subscribeToNetworkUpdates
} from '../api';

const STYLES = {
    container: {
        border: '1px solid #e2e8f0',
        borderRadius: '12px',
        backgroundColor: '#ffffff',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
        boxShadow: '0 2px 4px rgba(0,0,0,0.03)'
    },
    header: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: '1px solid #e2e8f0',
        backgroundColor: '#f8fafc',
        padding: '0 16px'
    },
    tabGroup: { display: 'flex', gap: '8px' },
    getTabStyle: (isActive) => ({
        padding: '12px 16px',
        fontWeight: 600,
        fontSize: '13px',
        cursor: 'pointer',
        border: 'none',
        background: 'none',
        borderBottom: isActive ? '3px solid #2563eb' : '3px solid transparent',
        color: isActive ? '#2563eb' : '#64748b'
    }),
    filterGroup: { display: 'flex', gap: '6px' },
    getFilterButtonStyle: (isActive) => ({
        fontSize: '11px',
        fontWeight: 600,
        padding: '3px 8px',
        borderRadius: '12px',
        border: '1px solid',
        borderColor: isActive ? '#2563eb' : '#cbd5e1',
        backgroundColor: isActive ? '#2563eb' : '#ffffff',
        color: isActive ? '#ffffff' : '#475569',
        cursor: 'pointer'
    }),
    getAlertStyle: (type) => ({
        padding: '10px 16px',
        fontSize: '12px',
        fontWeight: 600,
        backgroundColor: type === 'success' ? '#dcfce7' : type === 'info' ? '#e0f2fe' : '#fee2e2',
        color: type === 'success' ? '#15803d' : type === 'info' ? '#0369a1' : '#b91c1c',
        borderBottom: '1px solid #e2e8f0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
    }),
    alertCloseBtn: { border: 'none', background: 'none', cursor: 'pointer', fontWeight: 'bold' },
    manageTabContent: { padding: '16px', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' },
    loadingState: { textAlign: 'center', padding: '30px', color: '#64748b' },
    emptyState: { textAlign: 'center', padding: '40px', color: '#94a3b8' },
    emptyStateText: { margin: 0, fontSize: '14px' },
    transferCard: {
        border: '1px solid #e2e8f0',
        borderRadius: '10px',
        backgroundColor: '#ffffff',
        padding: '14px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
    },
    transferHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' },
    transferHeaderLeft: { display: 'flex', alignItems: 'center', gap: '8px' },
    transferMedicineName: { fontSize: '13px', color: '#0f172a' },
    getTransferBadgeStyle: (badge) => ({
        fontSize: '10px',
        fontWeight: 700,
        padding: '2px 6px',
        borderRadius: '4px',
        backgroundColor: badge.bg,
        color: badge.color
    }),
    transferDetails: { fontSize: '11px', color: '#64748b', marginTop: '2px' },
    transferDestination: { color: '#1e293b' },
    transferLevel: { fontSize: '11px', color: '#94a3b8' },
    matchList: { marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' },
    getMatchCardStyle: (isAccepted, isRejected) => ({
        padding: '10px 12px',
        borderRadius: '8px',
        backgroundColor: isAccepted ? '#f0fdf4' : isRejected ? '#fef2f2' : '#fffbeb',
        border: '1px solid',
        borderColor: isAccepted ? '#86efac' : isRejected ? '#fca5a5' : '#fde68a',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
    }),
    matchSupplierName: { fontSize: '12px', fontWeight: 600, color: '#1e293b' },
    matchDetails: { fontSize: '11px', color: '#475569', marginTop: '2px' },
    matchActions: { display: 'flex', gap: '6px' },
    acceptBtn: {
        backgroundColor: '#16a34a',
        color: '#ffffff',
        border: 'none',
        borderRadius: '6px',
        padding: '6px 12px',
        fontSize: '11px',
        fontWeight: 700,
        cursor: 'pointer'
    },
    rejectBtn: {
        backgroundColor: '#dc2626',
        color: '#ffffff',
        border: 'none',
        borderRadius: '6px',
        padding: '6px 10px',
        fontSize: '11px',
        fontWeight: 600,
        cursor: 'pointer'
    },
    getMatchStatusBadgeStyle: (isAccepted) => ({
        fontSize: '11px',
        fontWeight: 700,
        color: isAccepted ? '#16a34a' : '#dc2626',
        padding: '4px 8px',
        borderRadius: '4px',
        backgroundColor: isAccepted ? '#dcfce7' : '#fee2e2'
    }),
    noMatchesAlert: { padding: '8px', borderRadius: '6px', backgroundColor: '#fee2e2', color: '#b91c1c', fontSize: '11px' },
    requestTabContent: { padding: '18px', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '14px' },
    formLabel: { display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' },
    formSelect: {
        width: '100%',
        padding: '8px 10px',
        borderRadius: '8px',
        border: '1px solid #cbd5e1',
        fontSize: '13px',
        backgroundColor: '#ffffff'
    },
    formInput: {
        width: '100%',
        padding: '8px 10px',
        borderRadius: '8px',
        border: '1px solid #cbd5e1',
        fontSize: '13px',
        boxSizing: 'border-box'
    },
    suggestionAlert: {
        padding: '10px 12px',
        borderRadius: '8px',
        backgroundColor: '#eff6ff',
        border: '1px solid #bfdbfe',
        fontSize: '12px',
        color: '#1e40af'
    },
    suggestionTitle: { fontWeight: 600 },
    suggestionDetails: { fontSize: '11px', color: '#3b82f6', marginTop: '2px' },
    submitBtn: (disabled) => ({
        marginTop: 'auto',
        padding: '12px',
        backgroundColor: '#2563eb',
        color: '#ffffff',
        border: 'none',
        borderRadius: '8px',
        fontWeight: 700,
        fontSize: '13px',
        cursor: disabled ? 'not-allowed' : 'pointer'
    })
};


export default function TransferPanel({
    selectedFacilityId = 5,
    selectedMedicineId = 1,
    onFacilityChange
}) {
    const [activeTab, setActiveTab] = useState('manage'); // Default to manage so user sees requests & accept/reject immediately

    // Transfer list state
    const [transfers, setTransfers] = useState([]);
    const [filterStatus, setFilterStatus] = useState('all');
    const [facilities, setFacilities] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [actionMessage, setActionMessage] = useState(null);

    // Request form state
    const [requestingFacilityId, setRequestingFacilityId] = useState(selectedFacilityId || 5);
    const [requestingMedicineId, setRequestingMedicineId] = useState(selectedMedicineId || 1);
    const [requestQuantity, setRequestQuantity] = useState(30);
    const [suggestion, setSuggestion] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Sync when props change
    useEffect(() => {
        if (selectedFacilityId) setRequestingFacilityId(selectedFacilityId);
        if (selectedMedicineId) setRequestingMedicineId(selectedMedicineId);
    }, [selectedFacilityId, selectedMedicineId]);

    const loadTransfers = () => {
        setIsLoading(true);
        getTransfers().then(response => {
            setTransfers(response.items || []);
            setIsLoading(false);
        });
    };

    useEffect(() => {
        loadTransfers();
        getFacilities().then(response => {
            if (response && response.features) setFacilities(response.features);
        });

        const unsubscribe = subscribeToNetworkUpdates(loadTransfers);
        return () => unsubscribe();
    }, []);

    // Fetch suggested quantity for request tab
    useEffect(() => {
        getSuggestedQuantity(requestingFacilityId, requestingMedicineId).then(response => {
            setSuggestion(response);
            if (response.suggested_quantity) {
                setRequestQuantity(response.suggested_quantity);
            }
        });
    }, [requestingFacilityId, requestingMedicineId]);

    /**
     * Accepts a proposed transfer match and initiates the supply route.
     */
    const handleAccept = async (transferId, matchId, defaultQuantity) => {
        const quantityStr = window.prompt(`Confirm quantity to accept & dispatch (units):`, defaultQuantity);
        if (quantityStr === null) return; // User cancelled prompt

        const quantity = parseFloat(quantityStr) || defaultQuantity;
        try {
            await respondToTransfer(transferId, matchId, 'accept', quantity);
            setActionMessage({ type: 'success', text: `Transfer #${transferId} accepted! Route dispatched and in transit.` });
            setTimeout(() => setActionMessage(null), 3500);
        } catch (error) {
            setActionMessage({ type: 'error', text: 'Error accepting transfer: ' + error.message });
        }
    };

    /**
     * Rejects a proposed transfer match, escalating to the next tier supplier.
     */
    const handleReject = async (transferId, matchId) => {
        const confirmed = window.confirm(`Reject this proposed match? The system will automatically escalate to the next tier supplier.`);
        if (!confirmed) return;

        try {
            await respondToTransfer(transferId, matchId, 'reject');
            setActionMessage({ type: 'info', text: `Match rejected. Escalation engine triggered to find next candidate supplier.` });
            setTimeout(() => setActionMessage(null), 4000);
        } catch (error) {
            setActionMessage({ type: 'error', text: 'Error rejecting transfer: ' + error.message });
        }
    };

    /**
     * Creates a new supply transfer request.
     */
    const handleCreateTransfer = async (event) => {
        event.preventDefault();
        setIsSubmitting(true);
        setActionMessage(null);

        try {
            const newTransfer = await createTransfer({
                requesting_facility_id: requestingFacilityId,
                medicine_id: requestingMedicineId,
                quantity_requested: parseInt(requestQuantity, 10),
                priority: 'critical'
            });

            setActionMessage({ type: 'success', text: `Transfer request created! Proposed match found and route visualized.` });
            setActiveTab('manage');
            setTimeout(() => setActionMessage(null), 4000);
        } catch (error) {
            setActionMessage({ type: 'error', text: 'Failed to create transfer: ' + error.message });
        } finally {
            setIsSubmitting(false);
        }
    };

    const filteredTransfers = transfers.filter(transfer => {
        if (filterStatus === 'all') return true;
        return transfer.status === filterStatus;
    });

    const getStatusBadge = (status) => {
        switch (status) {
            case 'in_transit':
                return { bg: '#dbeafe', color: '#1d4ed8', label: '🚚 IN TRANSIT' };
            case 'pending':
                return { bg: '#fef3c7', color: '#b45309', label: '⏳ PENDING RESPONSE' };
            case 'escalated':
                return { bg: '#fee2e2', color: '#b91c1c', label: '🚨 ESCALATED' };
            case 'completed':
                return { bg: '#dcfce7', color: '#15803d', label: '✅ COMPLETED' };
            default:
                return { bg: '#f1f5f9', color: '#475569', label: status.toUpperCase() };
        }
    };

    return (
        <div style={STYLES.container}>
            {/* Header and Tabs */}
            <div style={STYLES.header}>
                <div style={STYLES.tabGroup}>
                    <button
                        onClick={() => setActiveTab('manage')}
                        style={STYLES.getTabStyle(activeTab === 'manage')}
                    >
                        Manage & Approve Transfers ({transfers.length})
                    </button>
                    <button
                        onClick={() => setActiveTab('request')}
                        style={STYLES.getTabStyle(activeTab === 'request')}
                    >
                        + Request New Supply
                    </button>
                </div>

                {activeTab === 'manage' && (
                    <div style={STYLES.filterGroup}>
                        {['all', 'pending', 'in_transit'].map(statusFilter => (
                            <button
                                key={statusFilter}
                                onClick={() => setFilterStatus(statusFilter)}
                                style={STYLES.getFilterButtonStyle(filterStatus === statusFilter)}
                            >
                                {statusFilter === 'all' ? 'All' : statusFilter === 'in_transit' ? 'In Transit' : 'Pending'}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Alert Message Banner */}
            {actionMessage && (
                <div style={STYLES.getAlertStyle(actionMessage.type)}>
                    <span>{actionMessage.text}</span>
                    <button onClick={() => setActionMessage(null)} style={STYLES.alertCloseBtn}>&times;</button>
                </div>
            )}

            {/* Tab 1: Manage & Approve Transfers */}
            {activeTab === 'manage' && (
                <div style={STYLES.manageTabContent}>
                    {isLoading ? (
                        <div style={STYLES.loadingState}>Loading transfers...</div>
                    ) : filteredTransfers.length === 0 ? (
                        <div style={STYLES.emptyState}>
                            <p style={STYLES.emptyStateText}>No transfers matching filter.</p>
                        </div>
                    ) : (
                        filteredTransfers.map(transfer => {
                            const badge = getStatusBadge(transfer.status);
                            const requestingFacilityName = facilities.find(facility => facility.properties.id === transfer.requesting_facility_id)?.properties?.name || `Facility #${transfer.requesting_facility_id}`;

                            return (
                                <div
                                    key={transfer.id}
                                    style={STYLES.transferCard}
                                >
                                    {/* Transfer Header */}
                                    <div style={STYLES.transferHeader}>
                                        <div>
                                            <div style={STYLES.transferHeaderLeft}>
                                                <strong style={STYLES.transferMedicineName}>
                                                    {transfer.medicine_name}
                                                </strong>
                                                <span style={STYLES.getTransferBadgeStyle(badge)}>
                                                    {badge.label}
                                                </span>
                                            </div>
                                            <div style={STYLES.transferDetails}>
                                                Destination: <strong style={STYLES.transferDestination}>{requestingFacilityName}</strong> &bull; Requested: {Math.round(transfer.quantity_requested)} units
                                            </div>
                                        </div>
                                        <span style={STYLES.transferLevel}>
                                            Level: {transfer.current_escalation_level.replace('_', ' ')}
                                        </span>
                                    </div>

                                    {/* Matches Section */}
                                    {transfer.matches && transfer.matches.length > 0 ? (
                                        <div style={STYLES.matchList}>
                                            {transfer.matches.map(match => {
                                                const isProposed = match.match_status === 'proposed';
                                                const isAccepted = match.match_status === 'accepted';
                                                const isRejected = match.match_status === 'rejected';

                                                return (
                                                    <div
                                                        key={match.id}
                                                        style={STYLES.getMatchCardStyle(isAccepted, isRejected)}
                                                    >
                                                        <div>
                                                            <div style={STYLES.matchSupplierName}>
                                                                Supplier: {match.supplying_facility_name}
                                                            </div>
                                                            <div style={STYLES.matchDetails}>
                                                                Offering: <strong>{Math.round(match.quantity_offered)} units</strong> &bull; {match.distance_km} km &bull; Est. Transit: {match.estimated_transit_minutes} mins
                                                            </div>
                                                        </div>

                                                        {/* Action Buttons for Accept & Reject */}
                                                        <div>
                                                            {isProposed ? (
                                                                <div style={STYLES.matchActions}>
                                                                    <button
                                                                        onClick={() => handleAccept(transfer.id, match.id, match.quantity_offered)}
                                                                        style={STYLES.acceptBtn}
                                                                    >
                                                                        ✓ Accept & Route
                                                                    </button>
                                                                    <button
                                                                        onClick={() => handleReject(transfer.id, match.id)}
                                                                        style={STYLES.rejectBtn}
                                                                    >
                                                                        ✕ Reject
                                                                    </button>
                                                                </div>
                                                            ) : (
                                                                <span style={STYLES.getMatchStatusBadgeStyle(isAccepted)}>
                                                                    {isAccepted ? '✓ ROUTE ACTIVE' : '✕ REJECTED'}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <div style={STYLES.noMatchesAlert}>
                                            No local surplus found. Request escalated to zonal authority for regional dispatch.
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>
            )}

            {/* Tab 2: Request New Supply Form */}
            {activeTab === 'request' && (
                <form onSubmit={handleCreateTransfer} style={STYLES.requestTabContent}>
                    <div>
                        <label style={STYLES.formLabel}>
                            Requesting Facility (Clinic or Hospital)
                        </label>
                        <select
                            value={requestingFacilityId}
                            onChange={(event) => setRequestingFacilityId(parseInt(event.target.value))}
                            style={STYLES.formSelect}
                        >
                            {facilities.map(facility => (
                                <option key={facility.properties.id} value={facility.properties.id}>
                                    [{facility.properties.type.toUpperCase()}] {facility.properties.name} ({facility.properties.worst_status})
                                </option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label style={STYLES.formLabel}>
                            Required Medicine
                        </label>
                        <select
                            value={requestingMedicineId}
                            onChange={(event) => setRequestingMedicineId(parseInt(event.target.value))}
                            style={STYLES.formSelect}
                        >
                            {MEDICINES.map(medicine => (
                                <option key={medicine.id} value={medicine.id}>
                                    {medicine.name} ({medicine.category})
                                </option>
                            ))}
                        </select>
                    </div>

                    {suggestion && (
                        <div style={STYLES.suggestionAlert}>
                            <div style={STYLES.suggestionTitle}>
                                🤖 ML Suggested Transfer Quantity: <strong>{Math.round(suggestion.suggested_quantity)} units</strong>
                            </div>
                            <div style={STYLES.suggestionDetails}>
                                Based on current stock ({Math.round(suggestion.based_on?.current_stock)}u), consumption rate ({Number(suggestion.based_on?.predicted_daily_consumption).toFixed(2)}/day), and {suggestion.based_on?.lead_time_days}-day lead time.
                            </div>
                        </div>
                    )}

                    <div>
                        <label style={STYLES.formLabel}>
                            Quantity to Request
                        </label>
                        <input
                            type="number"
                            min="1"
                            step="1"
                            value={requestQuantity}
                            onChange={(event) => setRequestQuantity(event.target.value)}
                            style={STYLES.formInput}
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={isSubmitting}
                        style={STYLES.submitBtn(isSubmitting)}
                    >
                        {isSubmitting ? 'Processing...' : 'Submit & Find Nearest Supply Route'}
                    </button>
                </form>
            )}
        </div>
    );
}