/**
 * App.jsx - Main Application Component
 * Orchestrates the Control Tower dashboard, managing state for facilities,
 * selected items, and coordinating between different visualization panels.
 */
import React, { useState, useEffect } from 'react';
import MapView from './comp/mapview';
import NetworkTopology from './comp/networktopology';
import TriageSummary from './comp/triagesummary';
import ForecastChart from './comp/forecastchart';
import TransferPanel from './comp/transferpanel';
import FacilityModal from './comp/facilitymodal';
import { getFacilities, subscribeToNetworkUpdates } from './api';

// Extracted styles to keep JSX clean and human-readable
const STYLES = {
    appContainer: {
        backgroundColor: 'var(--apple-bg)',
        minHeight: '100vh',
        padding: '24px 32px 64px 32px',
        boxSizing: 'border-box'
    },
    header: {
        marginBottom: '24px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: 'var(--apple-card)',
        padding: '16px 24px',
        borderRadius: '24px',
        border: 'var(--apple-border)',
        boxShadow: 'var(--apple-shadow)'
    },
    headerTitleContainer: { display: 'flex', alignItems: 'center', gap: '10px' },
    headerTitle: { margin: 0, fontSize: '19px', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em' },
    headerBadge: {
        fontSize: '11px',
        fontWeight: 700,
        padding: '3px 8px',
        backgroundColor: '#e0e7ff',
        color: '#3730a3',
        borderRadius: '12px'
    },
    headerSubtitle: { margin: '3px 0 0 0', fontSize: '12px', color: '#64748b' },
    controlsContainer: { display: 'flex', alignItems: 'center', gap: '10px' },
    buttonGroup: {
        display: 'flex',
        backgroundColor: '#e5e5ea',
        padding: '4px',
        borderRadius: '12px',
        border: 'none'
    },
    getButtonStyle: (isActive) => ({
        padding: '6px 12px',
        fontSize: '12px',
        fontWeight: 700,
        borderRadius: '6px',
        border: 'none',
        cursor: 'pointer',
        backgroundColor: isActive ? '#ffffff' : 'transparent',
        color: isActive ? '#2563eb' : '#64748b',
        boxShadow: isActive ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
    }),
    onlineStatus: {
        fontSize: '12px',
        padding: '6px 12px',
        backgroundColor: '#dcfce7',
        color: '#15803d',
        borderRadius: '20px',
        fontWeight: 700,
        display: 'flex',
        alignItems: 'center',
        gap: '6px'
    },
    onlineDot: { width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#16a34a' },
    wideLayout: { display: 'flex', flexDirection: 'column', gap: '16px' },
    canvasSection: { 
        backgroundColor: 'var(--apple-card)', 
        borderRadius: '24px', 
        width: '100%', 
        boxShadow: 'var(--apple-shadow)', 
        overflow: 'hidden' 
    },
    wideGrid: {
        display: 'grid',
        gridTemplateColumns: '1fr 1.15fr 1.15fr',
        gap: '16px',
        alignItems: 'start'
    },
    panelSection: { height: '440px' },
    splitLayout: {
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1.25fr) minmax(0, 1fr)',
        gap: '16px',
        alignItems: 'start'
    },
    splitColumn: { display: 'flex', flexDirection: 'column', gap: '16px' },
    splitForecast: { height: '360px' },
    splitTransfer: { minHeight: '440px' }
};

export default function App() {
    // Current visualization view: 'network' (Hierarchical Topology) or 'gis' (Google Maps)
    const [viewMode, setViewMode] = useState('network');

    // Layout mode: 'wide' (full width canvas on top, panels below) or 'split' (side-by-side)
    const [layoutMode, setLayoutMode] = useState('wide');

    // Selected facility & medicine for forecast & transfer details
    const [selectedFacility, setSelectedFacility] = useState(null);
    const [selectedMedicineId, setSelectedMedicineId] = useState(1);

    // Modal state (for clicking a facility to view inventory & route options)
    const [modalFacility, setModalFacility] = useState(null);

    // Facilities list cache
    const [facilities, setFacilities] = useState([]);

    /**
     * Loads the latest facility data from the backend.
     * Auto-selects the first critical facility if none is selected.
     */
    const loadFacilities = () => {
        getFacilities().then(response => {
            if (response && response.features) {
                setFacilities(response.features);
                if (!selectedFacility && response.features.length > 0) {
                    const criticalFacility = response.features.find(facility => facility.properties.worst_status === 'critical') || response.features[0];
                    setSelectedFacility(criticalFacility);
                }
            }
        });
    };

    // Initialize and subscribe to network updates
    useEffect(() => {
        loadFacilities();
        const unsubscribe = subscribeToNetworkUpdates(loadFacilities);
        return () => unsubscribe();
    }, []);

    const handleSelectFacility = (facility) => {
        setSelectedFacility(facility);
    };

    const handleOpenFacilityModal = (facility) => {
        setModalFacility(facility.properties ? { ...facility.properties, geometry: facility.geometry } : facility);
    };

    const handleCloseModal = () => {
        setModalFacility(null);
    };

    return (
        <div style={STYLES.appContainer}>
            {/* Top Navigation Bar */}
            <header style={STYLES.header}>
                <div>
                    <div style={STYLES.headerTitleContainer}>
                        <h1 style={STYLES.headerTitle}>
                            Control Tower
                        </h1>
                        <span style={STYLES.headerBadge}>
                            Autonomous Escalation Engine
                        </span>
                    </div>
                    <p style={STYLES.headerSubtitle}>
                        Healthcare Supply Chain &bull; 1 Zonal Distributor &bull; 3 Regional Hospitals &bull; 12 Clinics (4 per Hospital)
                    </p>
                </div>

                {/* View Switcher & Layout Controls */}
                <div style={STYLES.controlsContainer}>
                    {/* View Switcher: Network Topology vs Google Maps */}
                    <div style={STYLES.buttonGroup}>
                        <button
                            onClick={() => setViewMode('network')}
                            style={STYLES.getButtonStyle(viewMode === 'network')}
                        >
                            🕸️ Network Flow
                        </button>
                        <button
                            onClick={() => setViewMode('gis')}
                            style={STYLES.getButtonStyle(viewMode === 'gis')}
                        >
                            🗺️ Google Maps
                        </button>
                    </div>

                    {/* Layout Mode Switcher */}
                    <div style={STYLES.buttonGroup}>
                        <button
                            onClick={() => setLayoutMode('wide')}
                            title="Spacious Full Width View"
                            style={STYLES.getButtonStyle(layoutMode === 'wide')}
                        >
                            ⛶ Wide Canvas
                        </button>
                        <button
                            onClick={() => setLayoutMode('split')}
                            title="Side by Side Split View"
                            style={STYLES.getButtonStyle(layoutMode === 'split')}
                        >
                            ⊞ Split View
                        </button>
                    </div>

                    <div style={STYLES.onlineStatus}>
                        <span style={STYLES.onlineDot} />
                        16 Facilities Online
                    </div>
                </div>
            </header>

            {/* Content Layout (Wide vs Split) */}
            {layoutMode === 'wide' ? (
                /* WIDE LAYOUT: Full Width Network/Map Canvas on top, then 3 balanced columns below */
                <div style={STYLES.wideLayout}>
                    {/* Top Full-Width Visual Canvas */}
                    <section style={STYLES.canvasSection}>
                        {viewMode === 'network' ? (
                            <NetworkTopology
                                onSelectFacility={handleSelectFacility}
                                onOpenFacilityModal={handleOpenFacilityModal}
                            />
                        ) : (
                            <MapView
                                onSelectFacility={handleSelectFacility}
                                onOpenFacilityModal={handleOpenFacilityModal}
                            />
                        )}
                    </section>

                    {/* Bottom Panels: 3-Column Layout */}
                    <div style={STYLES.wideGrid}>
                        <section style={STYLES.panelSection}>
                            <ForecastChart
                                facilityId={selectedFacility?.properties?.id || 5}
                                medicineId={selectedMedicineId}
                                onMedicineChange={(medicineId) => setSelectedMedicineId(medicineId)}
                            />
                        </section>

                        <section style={STYLES.panelSection}>
                            <TriageSummary
                                facilities={facilities}
                                onSelectFacility={handleSelectFacility}
                                onOpenFacilityModal={handleOpenFacilityModal}
                            />
                        </section>

                        <section style={STYLES.panelSection}>
                            <TransferPanel
                                selectedFacilityId={selectedFacility?.properties?.id || 5}
                                selectedMedicineId={selectedMedicineId}
                                onFacilityChange={(facilityId) => {
                                    const foundFacility = facilities.find(facility => facility.properties.id === facilityId);
                                    if (foundFacility) setSelectedFacility(foundFacility);
                                }}
                            />
                        </section>
                    </div>
                </div>
            ) : (
                /* SPLIT LAYOUT: Side by Side */
                <div style={STYLES.splitLayout}>
                    {/* Left Column */}
                    <div style={STYLES.splitColumn}>
                        <section style={STYLES.canvasSection}>
                            {viewMode === 'network' ? (
                                <NetworkTopology
                                    onSelectFacility={handleSelectFacility}
                                    onOpenFacilityModal={handleOpenFacilityModal}
                                />
                            ) : (
                                <MapView
                                    onSelectFacility={handleSelectFacility}
                                    onOpenFacilityModal={handleOpenFacilityModal}
                                />
                            )}
                        </section>

                        <section style={STYLES.splitForecast}>
                            <ForecastChart
                                facilityId={selectedFacility?.properties?.id || 5}
                                medicineId={selectedMedicineId}
                                onMedicineChange={(medicineId) => setSelectedMedicineId(medicineId)}
                            />
                        </section>
                    </div>

                    {/* Right Column */}
                    <div style={STYLES.splitColumn}>
                        <section>
                            <TriageSummary
                                facilities={facilities}
                                onSelectFacility={handleSelectFacility}
                                onOpenFacilityModal={handleOpenFacilityModal}
                            />
                        </section>

                        <section style={STYLES.splitTransfer}>
                            <TransferPanel
                                selectedFacilityId={selectedFacility?.properties?.id || 5}
                                selectedMedicineId={selectedMedicineId}
                                onFacilityChange={(facilityId) => {
                                    const foundFacility = facilities.find(facility => facility.properties.id === facilityId);
                                    if (foundFacility) setSelectedFacility(foundFacility);
                                }}
                            />
                        </section>
                    </div>
                </div>
            )}

            {/* Interactive Facility Inspection & Routing Modal */}
            {modalFacility && (
                <FacilityModal
                    facility={modalFacility}
                    onClose={handleCloseModal}
                    onTransferRouted={() => {
                        loadFacilities();
                    }}
                />
            )}
        </div>
    );
}