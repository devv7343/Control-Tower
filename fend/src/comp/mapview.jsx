import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, Tooltip, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getFacilities, getTransfers, subscribeToNetworkUpdates } from '../api';

// Maps backend stock_status enums to UI colors
const STATUS_COLORS = {
    surplus: '#22c55e',   // green
    warning: '#f59e0b',   // amber
    critical: '#ef4444',  // red
    stockout: '#000000',  // black
    default: '#3b82f6'    // fallback blue
};

// Generates a colored circle marker for facilities
const createStatusIcon = (status, type) => {
    const color = STATUS_COLORS[status] || STATUS_COLORS.default;
    const size = type === 'distributor' ? 26 : type === 'hospital' ? 22 : 18;
    const border = type === 'distributor' ? '3px solid #0f172a' : '2px solid #ffffff';

    return L.divIcon({
        className: 'custom-status-icon',
        html: `<div style="
            background-color: ${color};
            width: ${size}px;
            height: ${size}px;
            border-radius: 50%;
            border: ${border};
            box-shadow: 0 2px 8px rgba(0,0,0,0.45);
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 11px;
            font-weight: 800;
        ">${type === 'distributor' ? '★' : type === 'hospital' ? 'H' : '•'}</div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
    });
};

// Creates a prominent on-map route badge at the polyline midpoint showing From ➔ To, Units & Time
const createRouteBadgeIcon = (route, zoomLevel = 11.5) => {
    const isTransit = route.isTransit;
    const bgGradient = isTransit 
        ? 'linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%)' 
        : 'linear-gradient(135deg, #78350f 0%, #d97706 100%)';
    const borderColor = isTransit ? '#60a5fa' : '#fcd34d';

    return L.divIcon({
        className: 'route-badge-marker',
        html: `
            <div style="
                background: ${bgGradient};
                color: #ffffff;
                padding: 3px 6px;
                border-radius: 12px;
                box-shadow: 0 2px 6px rgba(0,0,0,0.25);
                border: 1px solid ${borderColor};
                font-family: system-ui, -apple-system, sans-serif;
                white-space: nowrap;
                width: max-content;
                transform: translate(-50%, -50%) scale(${Math.max(0.15, Math.min(1.0, Math.pow(1.7, zoomLevel - 11.5)))});
                transform-origin: center;
                pointer-events: auto;
                cursor: pointer;
                display: flex;
                flex-direction: column;
                align-items: center;
            ">
                <div style="font-size: 9px; font-weight: 800; display: flex; gap: 4px; align-items: center;">
                    ${isTransit ? '🚚' : '⏳'} ${route.quantity}u ${(route.medicineName || 'Supply').split(' ')[0]}
                </div>
                <div style="font-size: 8px; color: #86efac; font-weight: 700;">
                    ${route.transitMinutes || 15}m ETA
                </div>
            </div>
        `,
        iconSize: [0, 0]
    });
};

function MapZoomListener({ setZoomLevel }) {
    useMapEvents({
        zoomend: (e) => {
            setZoomLevel(e.target.getZoom());
        }
    });
    return null;
}

export default function MapView({ onSelectFacility, onOpenFacilityModal }) {
    const [facilities, setFacilities] = useState([]);
    const [transfers, setTransfers] = useState([]);
    const [mapStyle, setMapStyle] = useState('roadmap'); // 'roadmap' or 'satellite'
    const [isLoading, setIsLoading] = useState(true);
    const [zoomLevel, setZoomLevel] = useState(11.5);
    const [showRoutesDropdown, setShowRoutesDropdown] = useState(false);

    const loadData = () => {
        Promise.all([getFacilities(), getTransfers()]).then(([facRes, transRes]) => {
            if (facRes && facRes.type === 'FeatureCollection') {
                setFacilities(facRes.features);
            }
            if (transRes && transRes.items) {
                setTransfers(transRes.items);
            }
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
            <div style={{ display: 'flex', height: '520px', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>
                Loading Google Maps background and supply routes...
            </div>
        );
    }

    // Default center Bengaluru
    const defaultCenter = [12.9650, 77.6000];

    // Build geographic routes with coordinates, direction, units, and transit times
    const geoRoutes = [];
    transfers.forEach(t => {
        if (t.status === 'in_transit' || t.status === 'pending') {
            const reqFac = facilities.find(f => f.properties.id === t.requesting_facility_id);
            t.matches.forEach(m => {
                if (m.match_status === 'accepted' || m.match_status === 'proposed') {
                    const supFac = facilities.find(f => f.properties.id === m.supplying_facility_id);
                    if (reqFac && supFac) {
                        const fromCoords = [supFac.geometry.coordinates[1], supFac.geometry.coordinates[0]];
                        const toCoords = [reqFac.geometry.coordinates[1], reqFac.geometry.coordinates[0]];
                        const midCoords = [(fromCoords[0] + toCoords[0]) / 2, (fromCoords[1] + toCoords[1]) / 2];

                        geoRoutes.push({
                            transferId: t.id,
                            matchId: m.id,
                            isTransit: m.match_status === 'accepted',
                            fromCoords: fromCoords,
                            toCoords: toCoords,
                            midCoords: midCoords,
                            supplyingName: supFac.properties.name,
                            requestingName: reqFac.properties.name,
                            medicineName: t.medicine_name,
                            quantity: m.quantity_offered,
                            transitMinutes: m.estimated_transit_minutes,
                            distanceKm: m.distance_km,
                            status: t.status
                        });
                    }
                }
            });
        }
    });

    // Google Maps Tile URLs
    const googleRoadmapUrl = "https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}";
    const googleSatelliteUrl = "https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}"; // Hybrid satellite with labels

    return (
        <div style={{
            height: '520px',
            width: '100%',
            borderRadius: '12px',
            overflow: 'hidden',
            border: '1px solid #e2e8f0',
            position: 'relative',
            boxShadow: '0 2px 6px rgba(0,0,0,0.05)'
        }}>
            {/* Map Controls: Map Style Toggle & Active Route Counter */}
            <div style={{
                position: 'absolute',
                top: 12,
                right: 12,
                zIndex: 1000,
                display: 'flex',
                gap: '8px',
                alignItems: 'center'
            }}>
                <div style={{
                    backgroundColor: 'rgba(255, 255, 255, 0.95)',
                    padding: '4px',
                    borderRadius: '8px',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
                    display: 'flex',
                    gap: '4px'
                }}>
                    <button
                        onClick={() => setMapStyle('roadmap')}
                        style={{
                            padding: '4px 10px',
                            fontSize: '11px',
                            fontWeight: 700,
                            borderRadius: '6px',
                            border: 'none',
                            cursor: 'pointer',
                            backgroundColor: mapStyle === 'roadmap' ? '#2563eb' : 'transparent',
                            color: mapStyle === 'roadmap' ? '#ffffff' : '#475569'
                        }}
                    >
                        🗺️ Google Roads
                    </button>
                    <button
                        onClick={() => setMapStyle('satellite')}
                        style={{
                            padding: '4px 10px',
                            fontSize: '11px',
                            fontWeight: 700,
                            borderRadius: '6px',
                            border: 'none',
                            cursor: 'pointer',
                            backgroundColor: mapStyle === 'satellite' ? '#2563eb' : 'transparent',
                            color: mapStyle === 'satellite' ? '#ffffff' : '#475569'
                        }}
                    >
                        🛰️ Google Satellite
                    </button>
                </div>

                <div style={{ position: 'relative' }}>
                    <div 
                        onClick={() => setShowRoutesDropdown(!showRoutesDropdown)}
                        style={{
                            backgroundColor: 'rgba(15, 23, 42, 0.85)',
                            backdropFilter: 'blur(10px)',
                            color: '#ffffff',
                            padding: '8px 14px',
                            borderRadius: '24px',
                            fontSize: '11.5px',
                            fontWeight: 600,
                            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                            cursor: 'pointer',
                            userSelect: 'none'
                        }}
                    >
                        🚚 {geoRoutes.length} Active Supply Routes
                    </div>
                    
                    {showRoutesDropdown && (
                        <div style={{
                            position: 'absolute',
                            top: '100%',
                            right: 0,
                            marginTop: '8px',
                            backgroundColor: '#ffffff',
                            borderRadius: '12px',
                            boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
                            border: '1px solid #e2e8f0',
                            width: '280px',
                            maxHeight: '300px',
                            overflowY: 'auto',
                            zIndex: 1001,
                            padding: '12px'
                        }}>
                            <h4 style={{ margin: '0 0 10px 0', fontSize: '13px', color: '#0f172a' }}>Active Routes</h4>
                            {geoRoutes.length === 0 ? (
                                <div style={{ fontSize: '12px', color: '#64748b' }}>No active routes.</div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    {geoRoutes.map((r, i) => (
                                        <div key={`dropdown-route-${i}`} style={{ padding: '8px', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid #f1f5f9' }}>
                                            <div style={{ fontSize: '11px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                                                {r.supplyingName} ➔ {r.requestingName}
                                            </div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#64748b' }}>
                                                <span>{r.quantity}u {r.medicineName}</span>
                                                <span style={{ color: '#16a34a', fontWeight: 600 }}>{r.transitMinutes}m ETA</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Map Legend */}
            <div style={{
                position: 'absolute',
                bottom: 24,
                left: 24,
                zIndex: 1000,
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                fontSize: '11.5px',
                backgroundColor: 'rgba(255, 255, 255, 0.85)',
                backdropFilter: 'blur(12px)',
                padding: '8px 16px',
                borderRadius: '24px',
                border: '1px solid rgba(226, 232, 240, 0.8)',
                boxShadow: '0 4px 16px rgba(0,0,0,0.1)'
            }}>
                <strong style={{ color: '#1d1d1f' }}>Legend:</strong>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: '#ef4444', border: '2px solid white', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
                    <span style={{ color: '#1d1d1f', fontWeight: 500 }}>Critical</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: '#f59e0b', border: '2px solid white', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
                    <span style={{ color: '#1d1d1f', fontWeight: 500 }}>Warning</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: '#22c55e', border: '2px solid white', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
                    <span style={{ color: '#1d1d1f', fontWeight: 500 }}>Surplus</span>
                </div>
            </div>

            <MapContainer center={defaultCenter} zoom={11.5} style={{ height: '100%', width: '100%' }}>
                <MapZoomListener setZoomLevel={setZoomLevel} />
                {/* Google Maps Tiles */}
                <TileLayer
                    key={mapStyle}
                    url={mapStyle === 'roadmap' ? googleRoadmapUrl : googleSatelliteUrl}
                    subdomains={['mt0', 'mt1', 'mt2', 'mt3']}
                    attribution="&copy; Google Maps"
                    maxZoom={20}
                />

                {/* Draw Route Polylines and Directional Flow on Google Map */}
                {geoRoutes.map((r, i) => (
                    <React.Fragment key={`geo-route-group-${r.transferId}-${i}`}>
                        {/* Outer Glow Polyline */}
                        <Polyline
                            positions={[r.fromCoords, r.toCoords]}
                            color={r.isTransit ? '#3b82f6' : '#f59e0b'}
                            weight={8}
                            opacity={0.3}
                        />

                        {/* Core Animated Route Polyline */}
                        <Polyline
                            positions={[r.fromCoords, r.toCoords]}
                            color={r.isTransit ? '#1d4ed8' : '#d97706'}
                            weight={4}
                            dashArray={r.isTransit ? '10, 8' : '6, 6'}
                            opacity={0.95}
                        >
                            <Tooltip sticky>
                                <div style={{ fontSize: '11px', lineHeight: 1.4 }}>
                                    <strong style={{ color: r.isTransit ? '#1d4ed8' : '#b45309' }}>
                                        {r.isTransit ? '🚚 SUPPLY IN TRANSIT' : '⏳ PROPOSED SUPPLY ROUTE'}
                                    </strong>
                                    <br />
                                    <strong>Origin:</strong> {r.supplyingName}<br />
                                    <strong>Destination:</strong> {r.requestingName}<br />
                                    <strong>Cargo:</strong> {r.medicineName} ({r.quantity} units)<br />
                                    <strong>Transit Time:</strong> {r.transitMinutes} mins ({r.distanceKm} km)
                                </div>
                            </Tooltip>
                        </Polyline>

                        {/* Permanent Midpoint Badge displaying Direction, Units and ETA */}
                        <Marker
                            position={r.midCoords}
                            icon={createRouteBadgeIcon(r, zoomLevel)}
                        >
                            <Popup minWidth={220}>
                                <div style={{ fontSize: '12px' }}>
                                    <div style={{ fontWeight: 'bold', color: '#1e293b', marginBottom: '4px' }}>
                                        Active Transfer #{r.transferId}
                                    </div>
                                    <div style={{ color: '#475569', marginBottom: '6px' }}>
                                        From: <strong>{r.supplyingName}</strong><br />
                                        To: <strong>{r.requestingName}</strong>
                                    </div>
                                    <div style={{ padding: '6px', background: '#eff6ff', borderRadius: '6px', color: '#1e40af', fontSize: '11px' }}>
                                        Cargo: <strong>{r.quantity} units</strong> of {r.medicineName}<br />
                                        Estimated arrival in <strong>{r.transitMinutes} mins</strong> ({r.distanceKm} km)
                                    </div>
                                </div>
                            </Popup>
                        </Marker>

                        {/* Destination Arrow Indicator at recipient coordinate */}
                        <Marker
                            position={r.toCoords}
                            icon={L.divIcon({
                                className: 'dest-arrow',
                                html: `<div style="
                                    background: #ef4444;
                                    color: white;
                                    border-radius: 50%;
                                    width: 14px;
                                    height: 14px;
                                    display: flex;
                                    align-items: center;
                                    justify-content: center;
                                    font-size: 9px;
                                    font-weight: bold;
                                    border: 2px solid white;
                                    box-shadow: 0 0 6px rgba(239, 68, 68, 0.8);
                                    transform: translate(-50%, -50%);
                                ">▼</div>`,
                                iconSize: [0, 0]
                            })}
                        />
                    </React.Fragment>
                ))}

                {/* Facility Markers */}
                {facilities.map((feature) => {
                    const [lon, lat] = feature.geometry.coordinates;
                    const { id, name, type, worst_status, medicines } = feature.properties;

                    return (
                        <Marker
                            key={id}
                            position={[lat, lon]}
                            icon={createStatusIcon(worst_status, type)}
                            eventHandlers={{
                                click: () => {
                                    if (onSelectFacility) onSelectFacility(feature);
                                }
                            }}
                        >
                            <Popup minWidth={240}>
                                <div style={{ marginBottom: '8px' }}>
                                    <h3 style={{ margin: '0 0 2px 0', fontSize: '14px', color: '#0f172a' }}>{name}</h3>
                                    <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'capitalize' }}>
                                        {type} &bull; Status: <strong style={{ color: STATUS_COLORS[worst_status] }}>{worst_status}</strong>
                                    </div>
                                </div>

                                <div style={{ maxHeight: '110px', overflowY: 'auto', borderTop: '1px solid #e2e8f0', paddingTop: '6px' }}>
                                    <table style={{ width: '100%', fontSize: '11px', textAlign: 'left', borderCollapse: 'collapse' }}>
                                        <thead>
                                            <tr style={{ color: '#64748b' }}>
                                                <th style={{ paddingBottom: '3px' }}>Medicine</th>
                                                <th style={{ paddingBottom: '3px' }}>Stock</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {medicines.map(med => (
                                                <tr key={med.medicine_id}>
                                                    <td style={{ padding: '2px 0' }}>{med.medicine_name.split(' ')[0]}</td>
                                                    <td style={{ padding: '2px 0' }}>
                                                        {med.current_stock}u
                                                        <span
                                                            style={{
                                                                display: 'inline-block',
                                                                width: '7px',
                                                                height: '7px',
                                                                borderRadius: '50%',
                                                                backgroundColor: STATUS_COLORS[med.status],
                                                                marginLeft: '5px'
                                                            }}
                                                            title={med.status}
                                                        />
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                <button
                                    onClick={() => onOpenFacilityModal && onOpenFacilityModal(feature)}
                                    style={{
                                        marginTop: '10px',
                                        width: '100%',
                                        padding: '7px',
                                        backgroundColor: '#2563eb',
                                        color: '#ffffff',
                                        border: 'none',
                                        borderRadius: '6px',
                                        fontSize: '11px',
                                        fontWeight: 700,
                                        cursor: 'pointer'
                                    }}
                                >
                                    Open Supply & Routing Drawer &rarr;
                                </button>
                            </Popup>
                        </Marker>
                    );
                })}
            </MapContainer>
        </div>
    );
}