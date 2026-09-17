/**
 * networktopology.jsx
 * Displays a hierarchical topology of the supply network.
 * Visualizes distributors, hospitals, and clinics along with animated active and proposed transfer routes.
 */
import React, { useState, useEffect, useRef } from 'react';
import { getFacilities, getTransfers, subscribeToNetworkUpdates } from '../api';

const STYLES = {
    outerContainer: {
        width: '100%',
        overflowX: 'hidden',
        backgroundColor: '#ffffff',
        borderRadius: '16px',
        border: '1px solid #e2e8f0',
        boxShadow: '0 4px 12px rgba(0,0,0,0.05)'
    },
    canvas: {
        position: 'relative',
        width: '100%',
        minHeight: '660px',
        padding: '24px 28px',
        boxSizing: 'border-box',
        backgroundColor: '#F5F5F7',
        userSelect: 'none'
    },
    headerBar: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '20px',
        zIndex: 20,
        position: 'relative'
    },
    headerTitleContainer: { display: 'flex', alignItems: 'center', gap: '8px' },
    headerTitle: { fontSize: '15px', fontWeight: 800, color: '#0f172a' },
    headerBadge: {
        fontSize: '11px',
        backgroundColor: '#e0e7ff',
        color: '#3730a3',
        padding: '2px 8px',
        borderRadius: '12px',
        fontWeight: 700
    },
    headerSubtitle: { margin: '2px 0 0 0', fontSize: '12px', color: '#64748b' },
    legend: {
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        fontSize: '11.5px',
        backgroundColor: 'rgba(255, 255, 255, 0.8)',
        backdropFilter: 'blur(10px)',
        padding: '8px 16px',
        borderRadius: '24px',
        border: '1px solid rgba(226, 232, 240, 0.8)',
        boxShadow: '0 4px 12px rgba(0,0,0,0.05)'
    },
    legendItem: { display: 'flex', alignItems: 'center', gap: '5px' },
    legendDot: (color) => ({ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: color }),
    svgLayer: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 5 },
    distributorCard: {
        padding: '12px 24px',
        borderRadius: '12px',
        backgroundColor: '#0f172a',
        color: '#ffffff',
        border: '2px solid #334155',
        cursor: 'pointer',
        textAlign: 'center',
        boxShadow: '0 6px 16px rgba(15, 23, 42, 0.15)',
        minWidth: '240px'
    },
    hospitalCard: {
        width: '100%',
        maxWidth: '300px',
        padding: '12px 18px',
        borderRadius: '12px',
        backgroundColor: '#ffffff',
        border: '2px solid #cbd5e1',
        cursor: 'pointer',
        textAlign: 'center',
        boxShadow: '0 4px 10px rgba(0,0,0,0.04)'
    },
    tooltip: (pos) => ({
        position: 'absolute',
        left: `${pos.x}px`,
        top: `${pos.y}px`,
        backgroundColor: 'rgba(15, 23, 42, 0.95)',
        color: '#ffffff',
        padding: '12px 14px',
        borderRadius: '10px',
        fontSize: '12px',
        pointerEvents: 'none',
        zIndex: 100,
        width: '220px',
        boxShadow: '0 10px 25px -5px rgba(0,0,0,0.5)',
        backdropFilter: 'blur(4px)',
        border: '1px solid rgba(255,255,255,0.1)'
    }),
    clusterBox: (colors) => ({
        backgroundColor: colors.bg,
        border: `1.5px solid ${colors.border}`,
        borderRadius: '14px',
        padding: '16px 14px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px'
    })
};

export default function NetworkTopology({ onSelectFacility, onOpenFacilityModal }) {
    const [facilities, setFacilities] = useState([]);
    const [transfers, setTransfers] = useState([]);
    const [hoveredFacility, setHoveredFacility] = useState(null);
    const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
    const [hoveredRouteId, setHoveredRouteId] = useState(null);

    const outerContainerRef = useRef(null);
    const canvasRef = useRef(null);
    const [nodePositions, setNodePositions] = useState({});

    /**
     * Fetches facility and transfer data from the API.
     */
    const loadData = () => {
        getFacilities().then(response => {
            if (response && response.features) setFacilities(response.features);
        });
        getTransfers().then(response => {
            if (response && response.items) setTransfers(response.items);
        });
    };

    useEffect(() => {
        loadData();
        const unsubscribe = subscribeToNetworkUpdates(loadData);
        return () => unsubscribe();
    }, []);

    /**
     * Computes the pixel positions of nodes relative to the canvas.
     */
    const updatePositions = () => {
        if (!canvasRef.current) return;
        const canvasRect = canvasRef.current.getBoundingClientRect();
        const positions = {};

        facilities.forEach(facility => {
            const element = document.getElementById(`topo-node-${facility.properties.id}`);
            if (element) {
                const elementRect = element.getBoundingClientRect();
                positions[facility.properties.id] = {
                    x: elementRect.left - canvasRect.left + elementRect.width / 2,
                    y: elementRect.top - canvasRect.top + elementRect.height / 2
                };
            }
        });
        setNodePositions(positions);
    };

    useEffect(() => {
        updatePositions();
        const timer = setTimeout(updatePositions, 200);
        window.addEventListener('resize', updatePositions);
        return () => {
            clearTimeout(timer);
            window.removeEventListener('resize', updatePositions);
        };
    }, [facilities, transfers]);

    const handleMouseEnter = (event, facility) => {
        if (!canvasRef.current) return;
        const canvasRect = canvasRef.current.getBoundingClientRect();
        let posX = event.clientX - canvasRect.left + 15;
        let posY = event.clientY - canvasRect.top + 15;
        
        // Prevent tooltip from overflowing the right/bottom edge
        if (posX + 240 > canvasRect.width) {
            posX = event.clientX - canvasRect.left - 240;
        }
        if (posY + 180 > canvasRect.height) {
            posY = event.clientY - canvasRect.top - 180;
        }
        
        setTooltipPosition({ x: posX, y: posY });
        setHoveredFacility(facility);
    };

    const handleMouseLeave = () => {
        setHoveredFacility(null);
    };

    const handleNodeClick = (facility) => {
        if (onSelectFacility) onSelectFacility(facility);
        if (onOpenFacilityModal) onOpenFacilityModal(facility);
    };

    const getStatusColor = (status) => {
        if (status === 'critical') return '#ef4444';
        if (status === 'warning') return '#f59e0b';
        if (status === 'in_route') return '#10b981';
        return '#22c55e';
    };

    // Separate facilities into hierarchy tiers
    const distributor = facilities.find(facility => facility.properties.type === 'distributor');
    const hospitals = facilities.filter(facility => facility.properties.type === 'hospital');
    const getClinicsForHospital = (hospitalId) => {
        return facilities.filter(facility => facility.properties.parent_facility_id === hospitalId && facility.properties.type === 'clinic');
    };

    // Active & proposed routes
    const activeRoutes = [];
    transfers.forEach(transfer => {
        if (transfer.status === 'in_transit' || transfer.status === 'pending') {
            transfer.matches.forEach(match => {
                if (match.match_status === 'accepted' || match.match_status === 'proposed') {
                    activeRoutes.push({
                        transferId: transfer.id,
                        status: transfer.status,
                        matchStatus: match.match_status,
                        sourceId: match.supplying_facility_id,
                        sourceName: match.supplying_facility_name,
                        targetId: transfer.requesting_facility_id,
                        targetName: transfer.requesting_facility_name,
                        medicineName: transfer.medicine_name,
                        quantity: match.quantity_offered,
                        transitMinutes: match.estimated_transit_minutes,
                        isAccepted: match.match_status === 'accepted'
                    });
                }
            });
        }
    });

    return (
        <div
            ref={outerContainerRef}
            style={STYLES.outerContainer}
        >
            <style>{`
                @keyframes routeDash {
                    to { stroke-dashoffset: -120; }
                }
                @keyframes pulseRoute {
                    0% { transform: scale(1); }
                    50% { transform: scale(1.04); }
                    100% { transform: scale(1); }
                }
                .topo-route-transit {
                    stroke: #2563eb;
                    stroke-width: 3.5;
                    stroke-dasharray: 8 6;
                    animation: routeDash 2s linear infinite;
                }
                .topo-route-proposed {
                    stroke: #f59e0b;
                    stroke-width: 2.5;
                    stroke-dasharray: 6 4;
                    animation: routeDash 4s linear infinite;
                }
                .topo-node-card {
                    transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
                }
                .topo-node-card:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 8px 16px -2px rgba(0,0,0,0.12);
                    border-color: #2563eb !important;
                }
            `}</style>

            {/* Inner Canvas with generous minWidth so right-end clinics are NEVER cut off */}
            <div
                ref={canvasRef}
                style={STYLES.canvas}
            >
                {/* Header Information Bar */}
                <div style={STYLES.headerBar}>
                    <div>
                        <div style={STYLES.headerTitleContainer}>
                            <span style={STYLES.headerTitle}>
                                Network Supply Chain Flow & Escalation Routes
                            </span>
                            <span style={STYLES.headerBadge}>
                                1 Distributor &bull; 3 Hospitals &bull; 12 Clinics
                            </span>
                        </div>
                        <p style={STYLES.headerSubtitle}>
                            Hover node for stock bars &bull; Click any node to open Supply Drawer &bull; Real-time animated delivery routes
                        </p>
                    </div>

                    <div style={STYLES.legend}>
                        <strong style={{ color: '#1d1d1f' }}>Legend:</strong>
                        <div style={STYLES.legendItem}>
                            <span style={STYLES.legendDot('#ef4444')} />
                            <span>Critical (&lt;15%)</span>
                        </div>
                        <div style={STYLES.legendItem}>
                            <span style={STYLES.legendDot('#f59e0b')} />
                            <span>Warning</span>
                        </div>
                        <div style={STYLES.legendItem}>
                            <span style={STYLES.legendDot('#22c55e')} />
                            <span>Surplus</span>
                        </div>
                        <div style={STYLES.legendItem}>
                            <span style={{ width: '16px', height: '3px', backgroundColor: '#2563eb', display: 'inline-block' }} />
                            <span>In-Transit Route</span>
                        </div>
                    </div>
                </div>

                {/* SVG Route Layer */}
                <svg
                    style={STYLES.svgLayer}
                >
                    <defs>
                        <marker id="topo-arrow-blue" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                            <path d="M 0 1 L 10 5 L 0 9 z" fill="#2563eb" />
                        </marker>
                        <marker id="topo-arrow-amber" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                            <path d="M 0 1 L 10 5 L 0 9 z" fill="#f59e0b" />
                        </marker>
                    </defs>

                    {/* Structural Hierarchy dashed lines */}
                    {distributor && hospitals.map(hospital => {
                        const distributorPos = nodePositions[distributor.properties.id];
                        const hospitalPos = nodePositions[hospital.properties.id];
                        if (!distributorPos || !hospitalPos) return null;
                        return (
                            <line
                                key={`hospital-link-${hospital.properties.id}`}
                                x1={distributorPos.x}
                                y1={distributorPos.y + 25}
                                x2={hospitalPos.x}
                                y2={hospitalPos.y - 25}
                                stroke="#cbd5e1"
                                strokeWidth="1.5"
                                strokeDasharray="5 5"
                            />
                        );
                    })}

                    {hospitals.map(hospital => {
                        const hospitalPos = nodePositions[hospital.properties.id];
                        const clinics = getClinicsForHospital(hospital.properties.id);
                        if (!hospitalPos) return null;

                        return clinics.map(clinic => {
                            const clinicPos = nodePositions[clinic.properties.id];
                            if (!clinicPos) return null;
                            return (
                                <line
                                    key={`clinic-link-${clinic.properties.id}`}
                                    x1={hospitalPos.x}
                                    y1={hospitalPos.y + 25}
                                    x2={clinicPos.x}
                                    y2={clinicPos.y - 25}
                                    stroke="#e2e8f0"
                                    strokeWidth="1"
                                />
                            );
                        });
                    })}

                    {/* Active Supply Routes */}
                    {activeRoutes.map((route, index) => {
                        const sourcePos = nodePositions[route.sourceId];
                        const targetPos = nodePositions[route.targetId];
                        if (!sourcePos || !targetPos) return null;

                        const isTransit = route.isAccepted;
                        const deltaX = targetPos.x - sourcePos.x;
                        const deltaY = targetPos.y - sourcePos.y;
                        const controlX = (sourcePos.x + targetPos.x) / 2 - deltaY * 0.18;
                        const controlY = (sourcePos.y + targetPos.y) / 2 + deltaX * 0.18;
                        const pathData = `M ${sourcePos.x} ${sourcePos.y} Q ${controlX} ${controlY} ${targetPos.x} ${targetPos.y}`;

                        return (
                            <g 
                                key={`svg-route-${route.transferId}-${index}`}
                                onMouseEnter={() => setHoveredRouteId(route.transferId)}
                                onMouseLeave={() => setHoveredRouteId(null)}
                                style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                            >
                                <path
                                    d={pathData}
                                    fill="none"
                                    stroke="transparent"
                                    strokeWidth="30"
                                    pointerEvents="stroke"
                                />
                                <path
                                    id={`route-path-${route.transferId}-${index}`}
                                    d={pathData}
                                    fill="none"
                                    stroke={isTransit ? 'rgba(37, 99, 235, 0.2)' : 'rgba(245, 158, 11, 0.2)'}
                                    strokeWidth="9"
                                    pointerEvents="none"
                                />
                                <path
                                    d={pathData}
                                    fill="none"
                                    className={isTransit ? 'topo-route-transit' : 'topo-route-proposed'}
                                    markerEnd={isTransit ? 'url(#topo-arrow-blue)' : 'url(#topo-arrow-amber)'}
                                    pointerEvents="none"
                                />
                                {isTransit ? (
                                    <polygon points="0,-6 12,0 0,6" fill="#1d4ed8">
                                        <animateMotion dur="2s" repeatCount="indefinite" rotate="auto">
                                            <mpath href={`#route-path-${route.transferId}-${index}`} />
                                        </animateMotion>
                                    </polygon>
                                ) : (
                                    <polygon points="0,-5 10,0 0,5" fill="#f59e0b">
                                        <animateMotion dur="3.5s" repeatCount="indefinite" rotate="auto">
                                            <mpath href={`#route-path-${route.transferId}-${index}`} />
                                        </animateMotion>
                                    </polygon>
                                )}
                            </g>
                        );
                    })}
                </svg>

                {/* Floating Route Badges with From ➔ To, Units & Time */}
                {activeRoutes.map((route, index) => {
                    if (hoveredRouteId !== route.transferId) return null;

                    const sourcePos = nodePositions[route.sourceId];
                    const targetPos = nodePositions[route.targetId];
                    if (!sourcePos || !targetPos) return null;

                    const midX = (sourcePos.x + targetPos.x) / 2;
                    const midY = (sourcePos.y + targetPos.y) / 2 - 18;
                    const isTransit = route.isAccepted;

                    return (
                        <div
                            key={`route-label-${route.transferId}-${index}`}
                            style={{
                                position: 'absolute',
                                left: `${midX}px`,
                                top: `${midY}px`,
                                transform: 'translate(-50%, -50%)',
                                backgroundColor: isTransit ? '#1e3a8a' : '#78350f',
                                color: '#ffffff',
                                padding: '5px 12px',
                                borderRadius: '18px',
                                fontSize: '11px',
                                fontWeight: 700,
                                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                                zIndex: 15,
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                gap: '2px',
                                border: isTransit ? '1.5px solid #60a5fa' : '1.5px solid #fcd34d',
                                pointerEvents: 'none',
                                animation: isTransit ? 'pulseRoute 2s infinite' : 'none',
                                whiteSpace: 'nowrap',
                                width: 'max-content'
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10px', color: '#e0f2fe' }}>
                                <span>{route.sourceName || 'Supplier'}</span>
                                <span style={{ color: '#fde047', fontWeight: 900 }}>➔</span>
                                <span>{route.targetName || 'Facility'}</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                <span>{isTransit ? '🚚' : '⏳'} {(route.medicineName || 'Med').split(' ')[0]}:</span>
                                <span style={{ color: '#93c5fd' }}>{route.quantity}u</span>
                                <span style={{ color: '#86efac' }}>• {route.transitMinutes || 15}m ETA</span>
                            </div>
                        </div>
                    );
                })}

                {/* 3-Tier Node Structure */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '32px', position: 'relative', zIndex: 10 }}>

                    {/* TIER 0: Central Zonal Distributor */}
                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                        {distributor && (
                            <div
                                id={`topo-node-${distributor.properties.id}`}
                                className="topo-node-card"
                                onClick={() => handleNodeClick(distributor)}
                                onMouseEnter={(event) => handleMouseEnter(event, distributor)}
                                onMouseLeave={handleMouseLeave}
                                style={STYLES.distributorCard}
                            >
                                <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#94a3b8', fontWeight: 700 }}>
                                    Tier 0 &bull; Central Logistics Hub
                                </div>
                                <div style={{ fontSize: '15px', fontWeight: 800, margin: '3px 0' }}>
                                    {distributor.properties.name}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '11px', color: '#cbd5e1' }}>
                                    <span style={{
                                        width: '8px',
                                        height: '8px',
                                        borderRadius: '50%',
                                        backgroundColor: getStatusColor(distributor.properties.worst_status)
                                    }} />
                                    <span>High Capacity Surplus OK</span>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* TIER 1: 3 Regional Hospitals */}
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(3, 1fr)',
                        gap: '24px'
                    }}>
                        {hospitals.map(hospital => (
                            <div key={hospital.properties.id} style={{ display: 'flex', justifyContent: 'center' }}>
                                <div
                                    id={`topo-node-${hospital.properties.id}`}
                                    className="topo-node-card"
                                    onClick={() => handleNodeClick(hospital)}
                                    onMouseEnter={(event) => handleMouseEnter(event, hospital)}
                                    onMouseLeave={handleMouseLeave}
                                    style={STYLES.hospitalCard}
                                >
                                    <div style={{ fontSize: '10px', textTransform: 'uppercase', fontWeight: 800, color: '#0284c7' }}>
                                        Tier 1 &bull; Regional Hospital
                                    </div>
                                    <div style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a', margin: '2px 0' }}>
                                        {hospital.properties.name}
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '11px', color: '#64748b' }}>
                                        <span style={{
                                            width: '8px',
                                            height: '8px',
                                            borderRadius: '50%',
                                            backgroundColor: getStatusColor(hospital.properties.worst_status)
                                        }} />
                                        <span>Status: <strong style={{ color: getStatusColor(hospital.properties.worst_status), textTransform: 'capitalize' }}>{hospital.properties.worst_status === 'in_route' ? 'In Route' : hospital.properties.worst_status}</strong></span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* TIER 2: 12 Clinics Arranged in 3 Spacious Cluster Cards (4 clinics each) */}
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(3, 1fr)',
                        gap: '24px'
                    }}>
                        {hospitals.map((hospital, hospitalIndex) => {
                            const clinics = getClinicsForHospital(hospital.properties.id);
                            const clusterColors = [
                                { border: '#bfdbfe', bg: '#eff6ff', title: '#1d4ed8' }, // Alpha
                                { border: '#c7d2fe', bg: '#eef2ff', title: '#4338ca' }, // Beta
                                { border: '#ddd6fe', bg: '#f5f3ff', title: '#6d28d9' }  // Gamma
                            ][hospitalIndex] || { border: '#e2e8f0', bg: '#ffffff', title: '#334155' };

                            return (
                                <div
                                    key={`cluster-box-${hospital.properties.id}`}
                                    style={STYLES.clusterBox(clusterColors)}
                                >
                                    <div style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        borderBottom: '1px solid rgba(0,0,0,0.08)',
                                        paddingBottom: '6px'
                                    }}>
                                        <span style={{ fontSize: '12px', fontWeight: 800, color: clusterColors.title }}>
                                            {hospital.properties.name.split(' ')[0]} Cluster
                                        </span>
                                        <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>
                                            4 Local Clinics
                                        </span>
                                    </div>

                                    {/* 2x2 Grid of Clinics inside cluster */}
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                        {clinics.map(clinic => {
                                            const worstStatus = clinic.properties.worst_status;
                                            const isCritical = worstStatus === 'critical';
                                            const isWarning = worstStatus === 'warning';

                                            return (
                                                <div
                                                    key={clinic.properties.id}
                                                    id={`topo-node-${clinic.properties.id}`}
                                                    className="topo-node-card"
                                                    onClick={() => handleNodeClick(clinic)}
                                                    onMouseEnter={(event) => handleMouseEnter(event, clinic)}
                                                    onMouseLeave={handleMouseLeave}
                                                    style={{
                                                        backgroundColor: '#ffffff',
                                                        border: isCritical ? '2px solid #ef4444' : isWarning ? '1.5px solid #f59e0b' : '1px solid #cbd5e1',
                                                        borderRadius: '10px',
                                                        padding: '10px',
                                                        cursor: 'pointer',
                                                        boxShadow: '0 2px 4px rgba(0,0,0,0.04)',
                                                        display: 'flex',
                                                        flexDirection: 'column',
                                                        justifyContent: 'space-between'
                                                    }}
                                                >
                                                    <div>
                                                        <div style={{
                                                            fontSize: '12px',
                                                            fontWeight: 700,
                                                            color: '#0f172a',
                                                            lineHeight: 1.2
                                                        }}>
                                                            {clinic.properties.name.replace('Clinic ', '')}
                                                        </div>
                                                        <div style={{ fontSize: '10px', color: '#64748b', marginTop: '2px' }}>
                                                            Tier 2 Clinic
                                                        </div>
                                                    </div>

                                                    <div style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'space-between',
                                                        marginTop: '8px',
                                                        paddingTop: '6px',
                                                        borderTop: '1px solid #f1f5f9'
                                                    }}>
                                                        <span style={{
                                                            fontSize: '10px',
                                                            fontWeight: 800,
                                                            textTransform: 'uppercase',
                                                            color: getStatusColor(worstStatus)
                                                        }}>
                                                            {worstStatus === 'in_route' ? 'IN ROUTE' : worstStatus}
                                                        </span>
                                                        <span style={{
                                                            width: '8px',
                                                            height: '8px',
                                                            borderRadius: '50%',
                                                            backgroundColor: getStatusColor(worstStatus)
                                                        }} />
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Hover Tooltip */}
                {hoveredFacility && (
                    <div
                        style={STYLES.tooltip(tooltipPosition)}
                    >
                        <div style={{ fontWeight: 'bold', fontSize: '13px', marginBottom: '2px' }}>
                            {hoveredFacility.properties.name}
                        </div>
                        <div style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '8px' }}>
                            {hoveredFacility.properties.type} &bull; Click to open supply drawer
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {hoveredFacility.properties.medicines.map(medicine => {
                                const fillPercentage = Math.min(100, Math.round((medicine.current_stock / medicine.capacity) * 100));
                                return (
                                    <div key={medicine.medicine_id}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '2px' }}>
                                            <span>{medicine.medicine_name.split(' ')[0]}</span>
                                            <span style={{ color: getStatusColor(medicine.status), fontWeight: 700 }}>{Math.round(medicine.current_stock)}u</span>
                                        </div>
                                        <div style={{ width: '100%', height: '5px', backgroundColor: '#334155', borderRadius: '3px', overflow: 'hidden' }}>
                                            <div style={{ width: `${fillPercentage}%`, height: '100%', backgroundColor: getStatusColor(medicine.status) }} />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
