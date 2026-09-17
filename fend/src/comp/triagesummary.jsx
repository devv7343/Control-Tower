/**
 * triagesummary.jsx
 * Component to display a list of all facilities and their medicine inventory status.
 * Allows filtering by status (Critical, Warning, Surplus) and searching by facility/medicine name.
 */
import React, { useEffect, useState } from 'react';
import { getInventory, subscribeToNetworkUpdates } from '../api';

const STATUS_STYLES = {
    surplus: { color: '#15803d', bg: '#dcfce7', label: 'Surplus' },
    warning: { color: '#b45309', bg: '#fef3c7', label: 'Warning' },
    critical: { color: '#b91c1c', bg: '#fee2e2', label: 'Critical' },
    stockout: { color: '#111827', bg: '#f3f4f6', label: 'Stockout' }
};

const STYLES = {
    loading: {
        padding: '20px',
        border: '1px solid #e2e8f0',
        borderRadius: '12px',
        minHeight: '300px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#64748b'
    },
    container: {
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        border: '1px solid #e2e8f0',
        padding: '20px',
        borderRadius: '12px',
        backgroundColor: '#ffffff',
        boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
        overflowX: 'hidden'
    },
    filterCardsContainer: { display: 'flex', gap: '12px' },
    getFilterCardStyle: (isActive, styleObj, activeBorderColor) => ({
        flex: 1,
        padding: '14px 16px',
        borderRadius: '10px',
        backgroundColor: styleObj.bg,
        border: isActive ? `2px solid ${activeBorderColor}` : `1px solid ${styleObj.color}33`,
        cursor: 'pointer',
        transition: 'transform 0.15s ease'
    }),
    filterCardTitle: (color) => ({ fontSize: '11px', color, fontWeight: 700, textTransform: 'uppercase' }),
    filterCardValue: (color) => ({ fontSize: '28px', fontWeight: 800, color, marginTop: '2px' }),
    headerContainer: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
    headerTitleContainer: { display: 'flex', alignItems: 'center', gap: '8px' },
    headerTitle: { margin: 0, fontSize: '14px', fontWeight: 700, color: '#0f172a' },
    searchInput: {
        padding: '6px 10px',
        fontSize: '12px',
        borderRadius: '6px',
        border: '1px solid #cbd5e1',
        width: '180px'
    },
    clearButton: {
        border: 'none',
        background: '#f1f5f9',
        color: '#475569',
        fontSize: '11px',
        padding: '4px 8px',
        borderRadius: '6px',
        cursor: 'pointer'
    },
    tableContainer: { maxHeight: '280px', overflowY: 'auto', overflowX: 'hidden' },
    table: { width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left', tableLayout: 'fixed' },
    th: { padding: '6px 8px' },
    td: { padding: '8px' },
    statusBadge: (style) => ({
        backgroundColor: style.bg,
        color: style.color,
        padding: '2px 8px',
        borderRadius: '12px',
        fontSize: '11px',
        fontWeight: 700,
        textTransform: 'capitalize'
    })
};

export default function TriageSummary({ onSelectFacility, onOpenFacilityModal, facilities = [] }) {
    const [inventoryData, setInventoryData] = useState({ summary: {}, items: [] });
    const [selectedStatusFilter, setSelectedStatusFilter] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [isLoading, setIsLoading] = useState(true);

    /**
     * Fetches inventory data from the backend API.
     */
    const loadInventoryData = () => {
        getInventory().then(response => {
            setInventoryData(response);
            setIsLoading(false);
        });
    };

    // Load data on mount and subscribe to network updates
    useEffect(() => {
        loadInventoryData();
        const unsubscribe = subscribeToNetworkUpdates(loadInventoryData);
        return () => unsubscribe();
    }, []);

    if (isLoading) {
        return (
            <div style={STYLES.loading}>
                Loading triage data across 16 facilities...
            </div>
        );
    }

    const { summary, items } = inventoryData;

    // Filter items based on the selected status and search query
    const filteredItems = items.filter(item => {
        if (selectedStatusFilter !== 'all' && item.status !== selectedStatusFilter) return false;
        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase();
            return item.facility_name.toLowerCase().includes(query) || item.medicine_name.toLowerCase().includes(query);
        }
        return true;
    });

    /**
     * Handles row click by locating the facility properties and opening the modal or selecting it.
     */
    const handleRowClick = (item) => {
        const facility = facilities.find(f => f.properties.id === item.facility_id);
        if (facility) {
            if (onSelectFacility) onSelectFacility(facility);
            if (onOpenFacilityModal) onOpenFacilityModal(facility);
        }
    };

    return (
        <div style={STYLES.container}>

            {/* Summary KPI Cards with Filter Clickability */}
            <div style={STYLES.filterCardsContainer}>
                <div
                    onClick={() => setSelectedStatusFilter(selectedStatusFilter === 'critical' ? 'all' : 'critical')}
                    style={STYLES.getFilterCardStyle(selectedStatusFilter === 'critical', STATUS_STYLES.critical, '#b91c1c')}
                >
                    <div style={STYLES.filterCardTitle(STATUS_STYLES.critical.color)}>
                        Critical Shortages
                    </div>
                    <div style={STYLES.filterCardValue(STATUS_STYLES.critical.color)}>
                        {summary.critical || 0}
                    </div>
                    <div style={{ fontSize: '10px', color: '#991b1b', marginTop: '2px' }}>
                        {selectedStatusFilter === 'critical' ? '● Filtering active' : 'Click to filter'}
                    </div>
                </div>

                <div
                    onClick={() => setSelectedStatusFilter(selectedStatusFilter === 'warning' ? 'all' : 'warning')}
                    style={STYLES.getFilterCardStyle(selectedStatusFilter === 'warning', STATUS_STYLES.warning, '#b45309')}
                >
                    <div style={STYLES.filterCardTitle(STATUS_STYLES.warning.color)}>
                        At Risk (Warning)
                    </div>
                    <div style={STYLES.filterCardValue(STATUS_STYLES.warning.color)}>
                        {summary.warning || 0}
                    </div>
                    <div style={{ fontSize: '10px', color: '#92400e', marginTop: '2px' }}>
                        {selectedStatusFilter === 'warning' ? '● Filtering active' : 'Click to filter'}
                    </div>
                </div>

                <div
                    onClick={() => setSelectedStatusFilter(selectedStatusFilter === 'surplus' ? 'all' : 'surplus')}
                    style={STYLES.getFilterCardStyle(selectedStatusFilter === 'surplus', STATUS_STYLES.surplus, '#15803d')}
                >
                    <div style={STYLES.filterCardTitle(STATUS_STYLES.surplus.color)}>
                        Healthy Surplus
                    </div>
                    <div style={STYLES.filterCardValue(STATUS_STYLES.surplus.color)}>
                        {summary.surplus || 0}
                    </div>
                    <div style={{ fontSize: '10px', color: '#166534', marginTop: '2px' }}>
                        {selectedStatusFilter === 'surplus' ? '● Filtering active' : 'Click to filter'}
                    </div>
                </div>
            </div>

            {/* Filter & Search Bar */}
            <div style={STYLES.headerContainer}>
                <div style={STYLES.headerTitleContainer}>
                    <h3 style={STYLES.headerTitle}>
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
                        onChange={(event) => setSearchQuery(event.target.value)}
                        style={STYLES.searchInput}
                    />
                    {selectedStatusFilter !== 'all' && (
                        <button
                            onClick={() => setSelectedStatusFilter('all')}
                            style={STYLES.clearButton}
                        >
                            Clear Filter &times;
                        </button>
                    )}
                </div>
            </div>

            {/* Triage List */}
            <div style={STYLES.tableContainer}>
                <table style={STYLES.table}>
                    <thead>
                        <tr style={{ borderBottom: '2px solid #e2e8f0', color: '#64748b' }}>
                            <th style={{ ...STYLES.th, width: '18%' }}>Facility</th>
                            <th style={{ ...STYLES.th, width: '25%' }}>Medicine</th>
                            <th style={{ ...STYLES.th, width: '17%' }}>Stock / Cap</th>
                            <th style={{ ...STYLES.th, width: '15%' }}>Burn Rate</th>
                            <th style={{ ...STYLES.th, width: '15%' }}>Status</th>
                            <th style={{ ...STYLES.th, textAlign: 'right', width: '10%' }}>Action</th>
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
                                    <td style={{ ...STYLES.td, fontWeight: 600, color: '#1e293b' }}>
                                        {item.facility_name}
                                    </td>
                                    <td style={{ ...STYLES.td, color: '#334155' }}>
                                        {item.medicine_name}
                                    </td>
                                    <td style={{ ...STYLES.td, color: '#475569' }}>
                                        {Math.round(item.current_stock)} / {Math.round(item.capacity || 100)}
                                    </td>
                                    <td style={{ ...STYLES.td, color: '#64748b' }}>
                                        {Number(item.avg_daily_consumption).toFixed(2)}/day
                                    </td>
                                    <td style={STYLES.td}>
                                        <span style={STYLES.statusBadge(style)}>
                                            {item.status}
                                        </span>
                                    </td>
                                    <td style={{ ...STYLES.td, textAlign: 'right' }}>
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