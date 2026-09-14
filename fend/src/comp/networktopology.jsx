import React, { useState, useEffect, useRef } from 'react';
import { getFacilities, getTransfers, subscribeToNetworkUpdates } from '../api';

export default function NetworkTopology({ onSelectFacility, onOpenFacilityModal }) {
    const [facilities, setFacilities] = useState([]);
    const [transfers, setTransfers] = useState([]);
    const [hoveredFacility, setHoveredFacility] = useState(null);
    const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
    const [hoveredRouteId, setHoveredRouteId] = useState(null);

    const outerContainerRef = useRef(null);
    const canvasRef = useRef(null);
    const [nodePositions, setNodePositions] = useState({});

    const loadData = () => {
        getFacilities().then(res => {
            if (res && res.features) setFacilities(res.features);
        });
        getTransfers().then(res => {
            if (res && res.items) setTransfers(res.items);
        });
    };

    useEffect(() => {
        loadData();
        const unsubscribe = subscribeToNetworkUpdates(loadData);
        return () => unsubscribe();
    }, []);

    // Compute pixel positions of nodes relative to the canvas
    const updatePositions = () => {
        if (!canvasRef.current) return;
        const canvasRect = canvasRef.current.getBoundingClientRect();
        const positions = {};

        facilities.forEach(f => {
            const el = document.getElementById(`topo-node-${f.properties.id}`);
            if (el) {
                const r = el.getBoundingClientRect();
                positions[f.properties.id] = {
                    x: r.left - canvasRect.left + r.width / 2,
                    y: r.top - canvasRect.top + r.height / 2
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

    const handleMouseEnter = (e, f) => {
        if (!canvasRef.current) return;
        const r = canvasRef.current.getBoundingClientRect();
        let x = e.clientX - r.left + 15;
        let y = e.clientY - r.top + 15;
        if (x + 280 > r.width) {
            x = e.clientX - r.left - 295;
        }
        setTooltipPos({ x, y });
        setHoveredFacility(f);
    };

    const handleMouseLeave = () => {
        setHoveredFacility(null);
    };

    const handleNodeClick = (f) => {
        if (onSelectFacility) onSelectFacility(f);
        if (onOpenFacilityModal) onOpenFacilityModal(f);
    };

    const getStatusColor = (status) => {
        if (status === 'critical') return '#ef4444';
        if (status === 'warning') return '#f59e0b';
        return '#22c55e';
    };

    // Separate facilities into hierarchy tiers
    const distributor = facilities.find(f => f.properties.type === 'distributor');
    const hospitals = facilities.filter(f => f.properties.type === 'hospital');
    const getClinicsForHospital = (hospId) => {
        return facilities.filter(f => f.properties.parent_facility_id === hospId && f.properties.type === 'clinic');
    };

    // Active & proposed routes
    const activeRoutes = [];
    transfers.forEach(t => {
        if (t.status === 'in_transit' || t.status === 'pending') {
            t.matches.forEach(m => {
                if (m.match_status === 'accepted' || m.match_status === 'proposed') {
                    activeRoutes.push({
                        transferId: t.id,
                        status: t.status,
                        matchStatus: m.match_status,
                        sourceId: m.supplying_facility_id,
                        sourceName: m.supplying_facility_name,
                        targetId: t.requesting_facility_id,
                        targetName: t.requesting_facility_name,
                        medicineName: t.medicine_name,
                        quantity: m.quantity_offered,
                        transitMinutes: m.estimated_transit_minutes,
                        isAccepted: m.match_status === 'accepted'
                    });
                }
            });
        }
    });

    return (
        <div
            ref={outerContainerRef}
            style={{
                width: '100%',
                overflowX: 'hidden',
                backgroundColor: '#ffffff',
                borderRadius: '16px',
                border: '1px solid #e2e8f0',
                boxShadow: '0 4px 12px rgba(0,0,0,0.05)'
            }}
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
                style={{
                    position: 'relative',
                    width: '100%',
                    minHeight: '660px',
                    padding: '24px 28px',
                    boxSizing: 'border-box',
                    backgroundColor: '#F5F5F7',
                    userSelect: 'none'
                }}
            >
                {/* Header Information Bar */}
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '20px',
                    zIndex: 20,
                    position: 'relative'
                }}>
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>
                                Network Supply Chain Flow & Escalation Routes
                            </span>
                            <span style={{
                                fontSize: '11px',
                                backgroundColor: '#e0e7ff',
                                color: '#3730a3',
                                padding: '2px 8px',
                                borderRadius: '12px',
                                fontWeight: 700
                            }}>
                                1 Distributor &bull; 3 Hospitals &bull; 12 Clinics
                            </span>
                        </div>
                        <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#64748b' }}>
                            Hover node for stock bars &bull; Click any node to open Supply Drawer &bull; Real-time animated delivery routes
                        </p>
                    </div>

                    <div style={{
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
                    }}>
                        <strong style={{ color: '#1d1d1f' }}>Legend:</strong>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                            <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#ef4444' }} />
                            <span>Critical (&lt;15%)</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                            <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#f59e0b' }} />
                            <span>Warning</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                            <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#22c55e' }} />
                            <span>Surplus</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                            <span style={{ width: '16px', height: '3px', backgroundColor: '#2563eb', display: 'inline-block' }} />
                            <span>In-Transit Route</span>
                        </div>
                    </div>
                </div>

                {/* SVG Route Layer */}
                <svg
                    style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        zIndex: 5
                    }}
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
                    {distributor && hospitals.map(h => {
                        const dPos = nodePositions[distributor.properties.id];
                        const hPos = nodePositions[h.properties.id];
                        if (!dPos || !hPos) return null;
                        return (
                            <line
                                key={`h-link-${h.properties.id}`}
                                x1={dPos.x}
                                y1={dPos.y + 25}
                                x2={hPos.x}
                                y2={hPos.y - 25}
                                stroke="#cbd5e1"
                                strokeWidth="1.5"
                                strokeDasharray="5 5"
                            />
                        );
                    })}

                    {hospitals.map(h => {
                        const hPos = nodePositions[h.properties.id];
                        const clinics = getClinicsForHospital(h.properties.id);
                        if (!hPos) return null;

                        return clinics.map(c => {
                            const cPos = nodePositions[c.properties.id];
                            if (!cPos) return null;
                            return (
                                <line
                                    key={`c-link-${c.properties.id}`}
                                    x1={hPos.x}
                                    y1={hPos.y + 25}
                                    x2={cPos.x}
                                    y2={cPos.y - 25}
                                    stroke="#e2e8f0"
                                    strokeWidth="1"
                                />
                            );
                        });
                    })}

                    {/* Active Supply Routes */}
                    {activeRoutes.map((route, idx) => {
                        const sPos = nodePositions[route.sourceId];
                        const tPos = nodePositions[route.targetId];
                        if (!sPos || !tPos) return null;

                        const isTransit = route.isAccepted;
                        const dx = tPos.x - sPos.x;
                        const dy = tPos.y - sPos.y;
                        const cx = (sPos.x + tPos.x) / 2 - dy * 0.18;
                        const cy = (sPos.y + tPos.y) / 2 + dx * 0.18;
                        const pathData = `M ${sPos.x} ${sPos.y} Q ${cx} ${cy} ${tPos.x} ${tPos.y}`;

                        return (
                            <g 
                                key={`svg-route-${route.transferId}-${idx}`}
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
                            </g>
                        );
                    })}
                </svg>

                {/* Floating Route Badges with From ➔ To, Units & Time */}
                {activeRoutes.map((route, idx) => {
                    if (hoveredRouteId !== route.transferId) return null;

                    const sPos = nodePositions[route.sourceId];
                    const tPos = nodePositions[route.targetId];
                    if (!sPos || !tPos) return null;

                    const midX = (sPos.x + tPos.x) / 2;
                    const midY = (sPos.y + tPos.y) / 2 - 18;
                    const isTransit = route.isAccepted;

                    return (
                        <div
                            key={`route-label-${route.transferId}-${idx}`}
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
                                onMouseEnter={(e) => handleMouseEnter(e, distributor)}
                                onMouseLeave={handleMouseLeave}
                                style={{
                                    padding: '12px 24px',
                                    borderRadius: '12px',
                                    backgroundColor: '#0f172a',
                                    color: '#ffffff',
                                    border: '2px solid #334155',
                                    cursor: 'pointer',
                                    textAlign: 'center',
                                    boxShadow: '0 6px 16px rgba(15, 23, 42, 0.15)',
                                    minWidth: '240px'
                                }}
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
                        {hospitals.map(h => (
                            <div key={h.properties.id} style={{ display: 'flex', justifyContent: 'center' }}>
                                <div
                                    id={`topo-node-${h.properties.id}`}
                                    className="topo-node-card"
                                    onClick={() => handleNodeClick(h)}
                                    onMouseEnter={(e) => handleMouseEnter(e, h)}
                                    onMouseLeave={handleMouseLeave}
                                    style={{
                                        width: '100%',
                                        maxWidth: '300px',
                                        padding: '12px 18px',
                                        borderRadius: '12px',
                                        backgroundColor: '#ffffff',
                                        border: '2px solid #cbd5e1',
                                        cursor: 'pointer',
                                        textAlign: 'center',
                                        boxShadow: '0 4px 10px rgba(0,0,0,0.04)'
                                    }}
                                >
                                    <div style={{ fontSize: '10px', textTransform: 'uppercase', fontWeight: 800, color: '#0284c7' }}>
                                        Tier 1 &bull; Regional Hospital
                                    </div>
                                    <div style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a', margin: '2px 0' }}>
                                        {h.properties.name}
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '11px', color: '#64748b' }}>
                                        <span style={{
                                            width: '8px',
                                            height: '8px',
                                            borderRadius: '50%',
                                            backgroundColor: getStatusColor(h.properties.worst_status)
                                        }} />
                                        <span>Status: <strong style={{ color: getStatusColor(h.properties.worst_status) }}>{h.properties.worst_status}</strong></span>
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
                        {hospitals.map((h, hIdx) => {
                            const clinics = getClinicsForHospital(h.properties.id);
                            const clusterColors = [
                                { border: '#bfdbfe', bg: '#eff6ff', title: '#1d4ed8' }, // Alpha
                                { border: '#c7d2fe', bg: '#eef2ff', title: '#4338ca' }, // Beta
                                { border: '#ddd6fe', bg: '#f5f3ff', title: '#6d28d9' }  // Gamma
                            ][hIdx] || { border: '#e2e8f0', bg: '#ffffff', title: '#334155' };

                            return (
                                <div
                                    key={`cluster-box-${h.properties.id}`}
                                    style={{
                                        backgroundColor: clusterColors.bg,
                                        border: `1.5px solid ${clusterColors.border}`,
                                        borderRadius: '14px',
                                        padding: '16px 14px',
                                        boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '12px'
                                    }}
                                >
                                    <div style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        borderBottom: '1px solid rgba(0,0,0,0.08)',
                                        paddingBottom: '6px'
                                    }}>
                                        <span style={{ fontSize: '12px', fontWeight: 800, color: clusterColors.title }}>
                                            {h.properties.name.split(' ')[0]} Cluster
                                        </span>
                                        <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>
                                            4 Local Clinics
                                        </span>
                                    </div>

                                    {/* 2x2 Grid of Clinics inside cluster */}
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                        {clinics.map(c => {
                                            const worst = c.properties.worst_status;
                                            const isCritical = worst === 'critical';
                                            const isWarning = worst === 'warning';

                                            return (
                                                <div
                                                    key={c.properties.id}
                                                    id={`topo-node-${c.properties.id}`}
                                                    className="topo-node-card"
                                                    onClick={() => handleNodeClick(c)}
                                                    onMouseEnter={(e) => handleMouseEnter(e, c)}
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
                                                            {c.properties.name.replace('Clinic ', '')}
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
                                                            color: getStatusColor(worst)
                                                        }}>
                                                            {worst}
                                                        </span>
                                                        <span style={{
                                                            width: '8px',
                                                            height: '8px',
                                                            borderRadius: '50%',
                                                            backgroundColor: getStatusColor(worst)
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

                {/* Hover Tooltip (From Reference Prototype) */}
                {hoveredFacility && (
                    <div
                        style={{
                            position: 'absolute',
                            left: `${tooltipPos.x}px`,
                            top: `${tooltipPos.y}px`,
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
                        }}
                    >
                        <div style={{ fontWeight: 'bold', fontSize: '13px', marginBottom: '2px' }}>
                            {hoveredFacility.properties.name}
                        </div>
                        <div style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '8px' }}>
                            {hoveredFacility.properties.type} &bull; Click to open supply drawer
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {hoveredFacility.properties.medicines.map(m => {
                                const fill = Math.min(100, Math.round((m.current_stock / m.capacity) * 100));
                                return (
                                    <div key={m.medicine_id}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '2px' }}>
                                            <span>{m.medicine_name.split(' ')[0]}</span>
                                            <span style={{ color: getStatusColor(m.status), fontWeight: 700 }}>{Math.round(m.current_stock)}u</span>
                                        </div>
                                        <div style={{ width: '100%', height: '5px', backgroundColor: '#334155', borderRadius: '3px', overflow: 'hidden' }}>
                                            <div style={{ width: `${fill}%`, height: '100%', backgroundColor: getStatusColor(m.status) }} />
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
