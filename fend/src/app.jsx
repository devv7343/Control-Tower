import React, { useState, useEffect } from 'react';
import MapView from './comp/mapview';
import NetworkTopology from './comp/networktopology';
import TriageSummary from './comp/triagesummary';
import ForecastChart from './comp/forecastchart';
import TransferPanel from './comp/transferpanel';
import FacilityModal from './comp/facilitymodal';
import { getFacilities, subscribeToNetworkUpdates } from './api';

export default function App() {
    // Current visualization view: 'network' (Hierarchical Topology from reference HTML) or 'gis' (Google Maps)
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

    const loadFacilities = () => {
        getFacilities().then(res => {
            if (res && res.features) {
                setFacilities(res.features);
                if (!selectedFacility && res.features.length > 0) {
                    const crit = res.features.find(f => f.properties.worst_status === 'critical') || res.features[0];
                    setSelectedFacility(crit);
                }
            }
        });
    };

    useEffect(() => {
        loadFacilities();
        const unsubscribe = subscribeToNetworkUpdates(loadFacilities);
        return () => unsubscribe();
    }, []);

    const handleSelectFacility = (fac) => {
        setSelectedFacility(fac);
    };

    const handleOpenFacilityModal = (fac) => {
        setModalFacility(fac.properties ? { ...fac.properties, geometry: fac.geometry } : fac);
    };

    const handleCloseModal = () => {
        setModalFacility(null);
    };

    return (
        <div style={{
            backgroundColor: 'var(--apple-bg)',
            minHeight: '100vh',
            padding: '24px 32px',
            boxSizing: 'border-box'
        }}>
            {/* Top Navigation Bar */}
            <header style={{
                marginBottom: '24px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                backgroundColor: 'var(--apple-card)',
                padding: '16px 24px',
                borderRadius: '24px',
                border: 'var(--apple-border)',
                boxShadow: 'var(--apple-shadow)'
            }}>
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <h1 style={{ margin: 0, fontSize: '19px', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em' }}>
                            Control Tower
                        </h1>
                        <span style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            padding: '3px 8px',
                            backgroundColor: '#e0e7ff',
                            color: '#3730a3',
                            borderRadius: '12px'
                        }}>
                            Autonomous Escalation Engine
                        </span>
                    </div>
                    <p style={{ margin: '3px 0 0 0', fontSize: '12px', color: '#64748b' }}>
                        Healthcare Supply Chain &bull; 1 Zonal Distributor &bull; 3 Regional Hospitals &bull; 12 Clinics (4 per Hospital)
                    </p>
                </div>

                {/* View Switcher & Layout Controls */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    {/* View Switcher: Network Topology vs Google Maps */}
                    <div style={{
                        display: 'flex',
                        backgroundColor: '#e5e5ea',
                        padding: '4px',
                        borderRadius: '12px',
                        border: 'none'
                    }}>
                        <button
                            onClick={() => setViewMode('network')}
                            style={{
                                padding: '6px 12px',
                                fontSize: '12px',
                                fontWeight: 700,
                                borderRadius: '6px',
                                border: 'none',
                                cursor: 'pointer',
                                backgroundColor: viewMode === 'network' ? '#ffffff' : 'transparent',
                                color: viewMode === 'network' ? '#2563eb' : '#64748b',
                                boxShadow: viewMode === 'network' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                            }}
                        >
                            🕸️ Network Flow
                        </button>
                        <button
                            onClick={() => setViewMode('gis')}
                            style={{
                                padding: '6px 12px',
                                fontSize: '12px',
                                fontWeight: 700,
                                borderRadius: '6px',
                                border: 'none',
                                cursor: 'pointer',
                                backgroundColor: viewMode === 'gis' ? '#ffffff' : 'transparent',
                                color: viewMode === 'gis' ? '#2563eb' : '#64748b',
                                boxShadow: viewMode === 'gis' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                            }}
                        >
                            🗺️ Google Maps
                        </button>
                    </div>

                    {/* Layout Mode Switcher */}
                    <div style={{
                        display: 'flex',
                        backgroundColor: '#e5e5ea',
                        padding: '4px',
                        borderRadius: '12px',
                        border: 'none'
                    }}>
                        <button
                            onClick={() => setLayoutMode('wide')}
                            title="Spacious Full Width View"
                            style={{
                                padding: '6px 10px',
                                fontSize: '12px',
                                fontWeight: 700,
                                borderRadius: '6px',
                                border: 'none',
                                cursor: 'pointer',
                                backgroundColor: layoutMode === 'wide' ? '#ffffff' : 'transparent',
                                color: layoutMode === 'wide' ? '#0f172a' : '#64748b',
                                boxShadow: layoutMode === 'wide' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                            }}
                        >
                            ⛶ Wide Canvas
                        </button>
                        <button
                            onClick={() => setLayoutMode('split')}
                            title="Side by Side Split View"
                            style={{
                                padding: '6px 10px',
                                fontSize: '12px',
                                fontWeight: 700,
                                borderRadius: '6px',
                                border: 'none',
                                cursor: 'pointer',
                                backgroundColor: layoutMode === 'split' ? '#ffffff' : 'transparent',
                                color: layoutMode === 'split' ? '#0f172a' : '#64748b',
                                boxShadow: layoutMode === 'split' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                            }}
                        >
                            ⊞ Split View
                        </button>
                    </div>

                    <div style={{
                        fontSize: '12px',
                        padding: '6px 12px',
                        backgroundColor: '#dcfce7',
                        color: '#15803d',
                        borderRadius: '20px',
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                    }}>
                        <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#16a34a' }} />
                        16 Facilities Online
                    </div>
                </div>
            </header>

            {/* Content Layout (Wide vs Split) */}
            {layoutMode === 'wide' ? (
                /* WIDE LAYOUT: Full Width Network/Map Canvas on top, then 3 balanced columns below */
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {/* Top Full-Width Visual Canvas */}
                    <section style={{ backgroundColor: 'var(--apple-card)', borderRadius: '24px', width: '100%', boxShadow: 'var(--apple-shadow)', overflow: 'hidden' }}>
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
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1.15fr 1.15fr',
                        gap: '16px',
                        alignItems: 'start'
                    }}>
                        <section style={{ height: '440px' }}>
                            <ForecastChart
                                facilityId={selectedFacility?.properties?.id || 5}
                                medicineId={selectedMedicineId}
                                onMedicineChange={(mId) => setSelectedMedicineId(mId)}
                            />
                        </section>

                        <section style={{ height: '440px' }}>
                            <TriageSummary
                                facilities={facilities}
                                onSelectFacility={handleSelectFacility}
                                onOpenFacilityModal={handleOpenFacilityModal}
                            />
                        </section>

                        <section style={{ height: '440px' }}>
                            <TransferPanel
                                selectedFacilityId={selectedFacility?.properties?.id || 5}
                                selectedMedicineId={selectedMedicineId}
                                onFacilityChange={(fId) => {
                                    const found = facilities.find(f => f.properties.id === fId);
                                    if (found) setSelectedFacility(found);
                                }}
                            />
                        </section>
                    </div>
                </div>
            ) : (
                /* SPLIT LAYOUT: Side by Side */
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, 1.25fr) minmax(0, 1fr)',
                    gap: '16px',
                    alignItems: 'start'
                }}>
                    {/* Left Column */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <section style={{ backgroundColor: 'var(--apple-card)', borderRadius: '24px', boxShadow: 'var(--apple-shadow)', overflow: 'hidden' }}>
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

                        <section style={{ height: '360px' }}>
                            <ForecastChart
                                facilityId={selectedFacility?.properties?.id || 5}
                                medicineId={selectedMedicineId}
                                onMedicineChange={(mId) => setSelectedMedicineId(mId)}
                            />
                        </section>
                    </div>

                    {/* Right Column */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <section>
                            <TriageSummary
                                facilities={facilities}
                                onSelectFacility={handleSelectFacility}
                                onOpenFacilityModal={handleOpenFacilityModal}
                            />
                        </section>

                        <section style={{ minHeight: '440px' }}>
                            <TransferPanel
                                selectedFacilityId={selectedFacility?.properties?.id || 5}
                                selectedMedicineId={selectedMedicineId}
                                onFacilityChange={(fId) => {
                                    const found = facilities.find(f => f.properties.id === fId);
                                    if (found) setSelectedFacility(found);
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