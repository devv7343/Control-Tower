import React, { useEffect, useState } from 'react';
import { getInventory, subscribeToNetworkUpdates } from '../api';

const STATUS_STYLES = {
    surplus: { color: '#15803d', bg: '#dcfce7', label: 'Surplus' },
    warning: { color: '#b45309', bg: '#fef3c7', label: 'Warning' },
    critical: { color: '#b91c1c', bg: '#fee2e2', label: 'Critical' },
    stockout: { color: '#111827', bg: '#f3f4f6', label: 'Stockout' }
};

export default function TriageSummary({ onSelectFacility, onOpenFacilityModal, facilities = [] }) {
    const [data, setData] = useState({ summary: {}, items: [] });
    const [selectedStatusFilter, setSelectedStatusFilter] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [isLoading, setIsLoading] = useState(true);

    const loadData = () => {
        getInventory().then(res => {
            setData(res);
            setIsLoading(false);
        });
    };

    useEffect(() => {
        loadData();
        const unsubscribe = subscribeToNetworkUpdates(loadData);
        return () => unsubscribe();
    }, []);

    if (isLoading) {
        return (
            <div style={{ padding: '20px', border: '1px solid #e2e8f0', borderRadius: '12px', minHeight: '300px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>
                Loading triage data across 16 facilities...
            </div>
        );
    }

    const { summary, items } = data;

    const filteredItems = items.filter(item => {
        if (selectedStatusFilter !== 'all' && item.status !== selectedStatusFilter) return false;
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            return item.facility_name.toLowerCase().includes(q) || item.medicine_name.toLowerCase().includes(q);
        }
        return true;
    });

    const handleRowClick = (item) => {
        const fac = facilities.find(f => f.properties.id === item.facility_id);
        if (fac) {
            if (onSelectFacility) onSelectFacility(fac);
            if (onOpenFacilityModal) onOpenFacilityModal(fac);
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', border: '1px solid #e2e8f0', padding: '20px', borderRadius: '12px', backgroundColor: '#ffffff', boxShadow: '0 1px 3px rgba(0,0,0,0.02)', overflowX: 'hidden' }}>

            {/* Summary KPI Cards with Filter Clickability */}
            <div style={{ display: 'flex', gap: '12px' }}>
                <div
                    onClick={() => setSelectedStatusFilter(selectedStatusFilter === 'critical' ? 'all' : 'critical')}
                    style={{
                        flex: 1,
                        padding: '14px 16px',
                        borderRadius: '10px',
                        backgroundColor: STATUS_STYLES.critical.bg,
                        border: selectedStatusFilter === 'critical' ? '2px solid #b91c1c' : `1px solid ${STATUS_STYLES.critical.color}33`,
                        cursor: 'pointer',
                        transition: 'transform 0.15s ease'
                    }}
                >
                    <div style={{ fontSize: '11px', color: STATUS_STYLES.critical.color, fontWeight: 700, textTransform: 'uppercase' }}>
                        Critical Shortages
                    </div>
                    <div style={{ fontSize: '28px', fontWeight: 800, color: STATUS_STYLES.critical.color, marginTop: '2px' }}>
                        {summary.critical || 0}
                    </div>
                    <div style={{ fontSize: '10px', color: '#991b1b', marginTop: '2px' }}>
                        {selectedStatusFilter === 'critical' ? '● Filtering active' : 'Click to filter'}
                    </div>
                </div>

                <div
                    onClick={() => setSelectedStatusFilter(selectedStatusFilter === 'warning' ? 'all' : 'warning')}
                    style={{
                        flex: 1,
                        padding: '14px 16px',
                        borderRadius: '10px',
                        backgroundColor: STATUS_STYLES.warning.bg,
                        border: selectedStatusFilter === 'warning' ? '2px solid #b45309' : `1px solid ${STATUS_STYLES.warning.color}33`,
                        cursor: 'pointer',
                        transition: 'transform 0.15s ease'
                    }}
                >
                    <div style={{ fontSize: '11px', color: STATUS_STYLES.warning.color, fontWeight: 700, textTransform: 'uppercase' }}>
                        At Risk (Warning)
                    </div>
                    <div style={{ fontSize: '28px', fontWeight: 800, color: STATUS_STYLES.warning.color, marginTop: '2px' }}>
                        {summary.warning || 0}
                    </div>
                    <div style={{ fontSize: '10px', color: '#92400e', marginTop: '2px' }}>
                        {selectedStatusFilter === 'warning' ? '● Filtering active' : 'Click to filter'}
                    </div>
                </div>

                <div
                    onClick={() => setSelectedStatusFilter(selectedStatusFilter === 'surplus' ? 'all' : 'surplus')}
                    style={{
                        flex: 1,
                        padding: '14px 16px',
                        borderRadius: '10px',
                        backgroundColor: STATUS_STYLES.surplus.bg,
                        border: selectedStatusFilter === 'surplus' ? '2px solid #15803d' : `1px solid ${STATUS_STYLES.surplus.color}33`,
                        cursor: 'pointer',
                        transition: 'transform 0.15s ease'
                    }}
                >
                    <div style={{ fontSize: '11px', color: STATUS_STYLES.surplus.color, fontWeight: 700, textTransform: 'uppercase' }}>
                        Healthy Surplus
                    </div>
                    <div style={{ fontSize: '28px', fontWeight: 800, color: STATUS_STYLES.surplus.color, marginTop: '2px' }}>
                        {summary.surplus || 0}
                    </div>
                    <div style={{ fontSize: '10px', color: '#166534', marginTop: '2px' }}>
                        {selectedStatusFilter === 'surplus' ? '● Filtering active' : 'Click to filter'}
                    </div>
                </div>
            </div>

            {/* Filter & Search Bar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>
                        Network Inventory Triage
                    </h3>
                    <span style={{ fontSize: '11px', color: '#64748b' }}>
                        ({filteredItems.length} items)
                    </span>
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                        type="text"
                        placeholder="Search facility or medicine..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        style={{
                            padding: '6px 10px',
                            fontSize: '12px',
                            borderRadius: '6px',
                            border: '1px solid #cbd5e1',
                            width: '180px'
                        }}
                    />
                    {selectedStatusFilter !== 'all' && (
                        <button
                            onClick={() => setSelectedStatusFilter('all')}
                            style={{
                                border: 'none',
                                background: '#f1f5f9',
                                color: '#475569',
                                fontSize: '11px',
                                padding: '4px 8px',
                                borderRadius: '6px',
                                cursor: 'pointer'
                            }}
                        >
                            Clear Filter &times;
                        </button>
                    )}
                </div>
            </div>

            {/* Triage List */}
            <div style={{ maxHeight: '280px', overflowY: 'auto', overflowX: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left', tableLayout: 'fixed' }}>
                    <thead>
                        <tr style={{ borderBottom: '2px solid #e2e8f0', color: '#64748b' }}>
                            <th style={{ padding: '6px 8px', width: '18%' }}>Facility</th>
                            <th style={{ padding: '6px 8px', width: '25%' }}>Medicine</th>
                            <th style={{ padding: '6px 8px', width: '17%' }}>Stock / Cap</th>
                            <th style={{ padding: '6px 8px', width: '15%' }}>Burn Rate</th>
                            <th style={{ padding: '6px 8px', width: '15%' }}>Status</th>
                            <th style={{ padding: '6px 8px', textAlign: 'right', width: '10%' }}>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredItems.map((item, index) => {
                            const style = STATUS_STYLES[item.status] || STATUS_STYLES.surplus;
                            return (
                                <tr
                                    key={`${item.facility_id}-${item.medicine_id}-${index}`}
                                    onClick={() => handleRowClick(item)}
                                    style={{
                                        borderBottom: '1px solid #f1f5f9',
                                        cursor: 'pointer',
                                        transition: 'background 0.1s'
                                    }}
                                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f8fafc'}
                                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                >
                                    <td style={{ padding: '8px', fontWeight: 600, color: '#1e293b' }}>
                                        {item.facility_name}
                                    </td>
                                    <td style={{ padding: '8px', color: '#334155' }}>
                                        {item.medicine_name}
                                    </td>
                                    <td style={{ padding: '8px', color: '#475569' }}>
                                        {Math.round(item.current_stock)} / {Math.round(item.capacity || 100)}
                                    </td>
                                    <td style={{ padding: '8px', color: '#64748b' }}>
                                        {Number(item.avg_daily_consumption).toFixed(2)}/day
                                    </td>
                                    <td style={{ padding: '8px' }}>
                                        <span style={{
                                            backgroundColor: style.bg,
                                            color: style.color,
                                            padding: '2px 8px',
                                            borderRadius: '12px',
                                            fontSize: '11px',
                                            fontWeight: 700,
                                            textTransform: 'capitalize'
                                        }}>
                                            {item.status}
                                        </span>
                                    </td>
                                    <td style={{ padding: '8px', textAlign: 'right' }}>
                                        <span style={{ color: '#2563eb', fontWeight: 600, fontSize: '11px' }}>
                                            Route &rarr;
                                        </span>
                                    </td>
                                </tr>
                            );
                        })}
                        {filteredItems.length === 0 && (
                            <tr>
                                <td colSpan="6" style={{ padding: '24px', textAlign: 'center', color: '#94a3b8' }}>
                                    No records matching filter.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

        </div>
    );
}