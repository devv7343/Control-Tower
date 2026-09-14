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
    const [reqFacilityId, setReqFacilityId] = useState(selectedFacilityId || 5);
    const [reqMedicineId, setReqMedicineId] = useState(selectedMedicineId || 1);
    const [requestQuantity, setRequestQuantity] = useState(30);
    const [suggestion, setSuggestion] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Sync when props change
    useEffect(() => {
        if (selectedFacilityId) setReqFacilityId(selectedFacilityId);
        if (selectedMedicineId) setReqMedicineId(selectedMedicineId);
    }, [selectedFacilityId, selectedMedicineId]);

    const loadTransfers = () => {
        setIsLoading(true);
        getTransfers().then(res => {
            setTransfers(res.items || []);
            setIsLoading(false);
        });
    };

    useEffect(() => {
        loadTransfers();
        getFacilities().then(res => {
            if (res && res.features) setFacilities(res.features);
        });

        const unsubscribe = subscribeToNetworkUpdates(loadTransfers);
        return () => unsubscribe();
    }, []);

    // Fetch suggested quantity for request tab
    useEffect(() => {
        getSuggestedQuantity(reqFacilityId, reqMedicineId).then(res => {
            setSuggestion(res);
            if (res.suggested_quantity) {
                setRequestQuantity(res.suggested_quantity);
            }
        });
    }, [reqFacilityId, reqMedicineId]);

    const handleAccept = async (transferId, matchId, defaultQty) => {
        const qtyStr = window.prompt(`Confirm quantity to accept & dispatch (units):`, defaultQty);
        if (qtyStr === null) return; // User cancelled prompt

        const qty = parseFloat(qtyStr) || defaultQty;
        try {
            await respondToTransfer(transferId, matchId, 'accept', qty);
            setActionMessage({ type: 'success', text: `Transfer #${transferId} accepted! Route dispatched and in transit.` });
            setTimeout(() => setActionMessage(null), 3500);
        } catch (err) {
            setActionMessage({ type: 'error', text: 'Error accepting transfer: ' + err.message });
        }
    };

    const handleReject = async (transferId, matchId) => {
        const confirmed = window.confirm(`Reject this proposed match? The system will automatically escalate to the next tier supplier.`);
        if (!confirmed) return;

        try {
            await respondToTransfer(transferId, matchId, 'reject');
            setActionMessage({ type: 'info', text: `Match rejected. Escalation engine triggered to find next candidate supplier.` });
            setTimeout(() => setActionMessage(null), 4000);
        } catch (err) {
            setActionMessage({ type: 'error', text: 'Error rejecting transfer: ' + err.message });
        }
    };

    const handleCreateTransfer = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        setActionMessage(null);

        try {
            const newT = await createTransfer({
                requesting_facility_id: reqFacilityId,
                medicine_id: reqMedicineId,
                quantity_requested: parseFloat(requestQuantity),
                priority: 'critical'
            });

            setActionMessage({ type: 'success', text: `Transfer request created! Proposed match found and route visualized.` });
            setActiveTab('manage');
            setTimeout(() => setActionMessage(null), 4000);
        } catch (err) {
            setActionMessage({ type: 'error', text: 'Failed to create transfer: ' + err.message });
        } finally {
            setIsSubmitting(false);
        }
    };

    const filteredTransfers = transfers.filter(t => {
        if (filterStatus === 'all') return true;
        return t.status === filterStatus;
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
        <div style={{
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            backgroundColor: '#ffffff',
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            overflow: 'hidden',
            boxShadow: '0 2px 4px rgba(0,0,0,0.03)'
        }}>
            {/* Header and Tabs */}
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderBottom: '1px solid #e2e8f0',
                backgroundColor: '#f8fafc',
                padding: '0 16px'
            }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                        onClick={() => setActiveTab('manage')}
                        style={{
                            padding: '12px 16px',
                            fontWeight: 600,
                            fontSize: '13px',
                            cursor: 'pointer',
                            border: 'none',
                            background: 'none',
                            borderBottom: activeTab === 'manage' ? '3px solid #2563eb' : '3px solid transparent',
                            color: activeTab === 'manage' ? '#2563eb' : '#64748b'
                        }}
                    >
                        Manage & Approve Transfers ({transfers.length})
                    </button>
                    <button
                        onClick={() => setActiveTab('request')}
                        style={{
                            padding: '12px 16px',
                            fontWeight: 600,
                            fontSize: '13px',
                            cursor: 'pointer',
                            border: 'none',
                            background: 'none',
                            borderBottom: activeTab === 'request' ? '3px solid #2563eb' : '3px solid transparent',
                            color: activeTab === 'request' ? '#2563eb' : '#64748b'
                        }}
                    >
                        + Request New Supply
                    </button>
                </div>

                {activeTab === 'manage' && (
                    <div style={{ display: 'flex', gap: '6px' }}>
                        {['all', 'pending', 'in_transit'].map(s => (
                            <button
                                key={s}
                                onClick={() => setFilterStatus(s)}
                                style={{
                                    fontSize: '11px',
                                    fontWeight: 600,
                                    padding: '3px 8px',
                                    borderRadius: '12px',
                                    border: '1px solid',
                                    borderColor: filterStatus === s ? '#2563eb' : '#cbd5e1',
                                    backgroundColor: filterStatus === s ? '#2563eb' : '#ffffff',
                                    color: filterStatus === s ? '#ffffff' : '#475569',
                                    cursor: 'pointer'
                                }}
                            >
                                {s === 'all' ? 'All' : s === 'in_transit' ? 'In Transit' : 'Pending'}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Alert Message Banner */}
            {actionMessage && (
                <div style={{
                    padding: '10px 16px',
                    fontSize: '12px',
                    fontWeight: 600,
                    backgroundColor: actionMessage.type === 'success' ? '#dcfce7' : actionMessage.type === 'info' ? '#e0f2fe' : '#fee2e2',
                    color: actionMessage.type === 'success' ? '#15803d' : actionMessage.type === 'info' ? '#0369a1' : '#b91c1c',
                    borderBottom: '1px solid #e2e8f0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                }}>
                    <span>{actionMessage.text}</span>
                    <button onClick={() => setActionMessage(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', fontWeight: 'bold' }}>&times;</button>
                </div>
            )}

            {/* Tab 1: Manage & Approve Transfers */}
            {activeTab === 'manage' && (
                <div style={{ padding: '16px', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {isLoading ? (
                        <div style={{ textAlign: 'center', padding: '30px', color: '#64748b' }}>Loading transfers...</div>
                    ) : filteredTransfers.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>
                            <p style={{ margin: 0, fontSize: '14px' }}>No transfers matching filter.</p>
                        </div>
                    ) : (
                        filteredTransfers.map(t => {
                            const badge = getStatusBadge(t.status);
                            const requestingFacility = facilities.find(f => f.properties.id === t.requesting_facility_id)?.properties?.name || `Facility #${t.requesting_facility_id}`;

                            return (
                                <div
                                    key={t.id}
                                    style={{
                                        border: '1px solid #e2e8f0',
                                        borderRadius: '10px',
                                        backgroundColor: '#ffffff',
                                        padding: '14px',
                                        boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
                                    }}
                                >
                                    {/* Transfer Header */}
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                                        <div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <strong style={{ fontSize: '13px', color: '#0f172a' }}>
                                                    {t.medicine_name}
                                                </strong>
                                                <span style={{
                                                    fontSize: '10px',
                                                    fontWeight: 700,
                                                    padding: '2px 6px',
                                                    borderRadius: '4px',
                                                    backgroundColor: badge.bg,
                                                    color: badge.color
                                                }}>
                                                    {badge.label}
                                                </span>
                                            </div>
                                            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                                                Destination: <strong style={{ color: '#1e293b' }}>{requestingFacility}</strong> &bull; Requested: {t.quantity_requested} units
                                            </div>
                                        </div>
                                        <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                                            Level: {t.current_escalation_level.replace('_', ' ')}
                                        </span>
                                    </div>

                                    {/* Matches Section */}
                                    {t.matches && t.matches.length > 0 ? (
                                        <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                            {t.matches.map(m => {
                                                const isProposed = m.match_status === 'proposed';
                                                const isAccepted = m.match_status === 'accepted';
                                                const isRejected = m.match_status === 'rejected';

                                                return (
                                                    <div
                                                        key={m.id}
                                                        style={{
                                                            padding: '10px 12px',
                                                            borderRadius: '8px',
                                                            backgroundColor: isAccepted ? '#f0fdf4' : isRejected ? '#fef2f2' : '#fffbeb',
                                                            border: '1px solid',
                                                            borderColor: isAccepted ? '#86efac' : isRejected ? '#fca5a5' : '#fde68a',
                                                            display: 'flex',
                                                            justifyContent: 'space-between',
                                                            alignItems: 'center'
                                                        }}
                                                    >
                                                        <div>
                                                            <div style={{ fontSize: '12px', fontWeight: 600, color: '#1e293b' }}>
                                                                Supplier: {m.supplying_facility_name}
                                                            </div>
                                                            <div style={{ fontSize: '11px', color: '#475569', marginTop: '2px' }}>
                                                                Offering: <strong>{m.quantity_offered} units</strong> &bull; {m.distance_km} km &bull; Est. Transit: {m.estimated_transit_minutes} mins
                                                            </div>
                                                        </div>

                                                        {/* Action Buttons for Accept & Reject */}
                                                        <div>
                                                            {isProposed ? (
                                                                <div style={{ display: 'flex', gap: '6px' }}>
                                                                    <button
                                                                        onClick={() => handleAccept(t.id, m.id, m.quantity_offered)}
                                                                        style={{
                                                                            backgroundColor: '#16a34a',
                                                                            color: '#ffffff',
                                                                            border: 'none',
                                                                            borderRadius: '6px',
                                                                            padding: '6px 12px',
                                                                            fontSize: '11px',
                                                                            fontWeight: 700,
                                                                            cursor: 'pointer'
                                                                        }}
                                                                    >
                                                                        ✓ Accept & Route
                                                                    </button>
                                                                    <button
                                                                        onClick={() => handleReject(t.id, m.id)}
                                                                        style={{
                                                                            backgroundColor: '#dc2626',
                                                                            color: '#ffffff',
                                                                            border: 'none',
                                                                            borderRadius: '6px',
                                                                            padding: '6px 10px',
                                                                            fontSize: '11px',
                                                                            fontWeight: 600,
                                                                            cursor: 'pointer'
                                                                        }}
                                                                    >
                                                                        ✕ Reject
                                                                    </button>
                                                                </div>
                                                            ) : (
                                                                <span style={{
                                                                    fontSize: '11px',
                                                                    fontWeight: 700,
                                                                    color: isAccepted ? '#16a34a' : '#dc2626',
                                                                    padding: '4px 8px',
                                                                    borderRadius: '4px',
                                                                    backgroundColor: isAccepted ? '#dcfce7' : '#fee2e2'
                                                                }}>
                                                                    {isAccepted ? '✓ ROUTE ACTIVE' : '✕ REJECTED'}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <div style={{ padding: '8px', borderRadius: '6px', backgroundColor: '#fee2e2', color: '#b91c1c', fontSize: '11px' }}>
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
                <form onSubmit={handleCreateTransfer} style={{ padding: '18px', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <div>
                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                            Requesting Facility (Clinic or Hospital)
                        </label>
                        <select
                            value={reqFacilityId}
                            onChange={(e) => setReqFacilityId(parseInt(e.target.value))}
                            style={{
                                width: '100%',
                                padding: '8px 10px',
                                borderRadius: '8px',
                                border: '1px solid #cbd5e1',
                                fontSize: '13px',
                                backgroundColor: '#ffffff'
                            }}
                        >
                            {facilities.map(f => (
                                <option key={f.properties.id} value={f.properties.id}>
                                    [{f.properties.type.toUpperCase()}] {f.properties.name} ({f.properties.worst_status})
                                </option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                            Required Medicine
                        </label>
                        <select
                            value={reqMedicineId}
                            onChange={(e) => setReqMedicineId(parseInt(e.target.value))}
                            style={{
                                width: '100%',
                                padding: '8px 10px',
                                borderRadius: '8px',
                                border: '1px solid #cbd5e1',
                                fontSize: '13px',
                                backgroundColor: '#ffffff'
                            }}
                        >
                            {MEDICINES.map(m => (
                                <option key={m.id} value={m.id}>
                                    {m.name} ({m.category})
                                </option>
                            ))}
                        </select>
                    </div>

                    {suggestion && (
                        <div style={{
                            padding: '10px 12px',
                            borderRadius: '8px',
                            backgroundColor: '#eff6ff',
                            border: '1px solid #bfdbfe',
                            fontSize: '12px',
                            color: '#1e40af'
                        }}>
                            <div style={{ fontWeight: 600 }}>
                                🤖 ML Suggested Transfer Quantity: <strong>{suggestion.suggested_quantity} units</strong>
                            </div>
                            <div style={{ fontSize: '11px', color: '#3b82f6', marginTop: '2px' }}>
                                Based on current stock ({suggestion.based_on?.current_stock}u), consumption rate ({suggestion.based_on?.predicted_daily_consumption}/day), and {suggestion.based_on?.lead_time_days}-day lead time.
                            </div>
                        </div>
                    )}

                    <div>
                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                            Quantity to Request
                        </label>
                        <input
                            type="number"
                            min="1"
                            value={requestQuantity}
                            onChange={(e) => setRequestQuantity(e.target.value)}
                            style={{
                                width: '100%',
                                padding: '8px 10px',
                                borderRadius: '8px',
                                border: '1px solid #cbd5e1',
                                fontSize: '13px',
                                boxSizing: 'border-box'
                            }}
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={isSubmitting}
                        style={{
                            marginTop: 'auto',
                            padding: '12px',
                            backgroundColor: '#2563eb',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: '8px',
                            fontWeight: 700,
                            fontSize: '13px',
                            cursor: isSubmitting ? 'not-allowed' : 'pointer'
                        }}
                    >
                        {isSubmitting ? 'Processing...' : 'Submit & Find Nearest Supply Route'}
                    </button>
                </form>
            )}
        </div>
    );
}