/**
 * mapview.jsx
 * Renders a geographic map using React-Leaflet to visualize facility locations,
 * inventory statuses, and animated supply transfer routes.
 */
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

/**
 * Generates a colored circle marker for facilities based on their status and type.
 */
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

/**
 * Creates a prominent on-map route badge at the polyline midpoint showing From ➔ To, Units & Time.
 */
const createRouteBadgeIcon = (route, zoomLevel = 11.5) => {
    const isTransit = route.isTransit;
    const backgroundGradient = isTransit 
        ? 'linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%)' 
        : 'linear-gradient(135deg, #78350f 0%, #d97706 100%)';
    const borderColor = isTransit ? '#60a5fa' : '#fcd34d';

    return L.divIcon({
        className: 'route-badge-marker',
        html: `
            <div style="
                background: ${backgroundGradient};
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

/**
 * A hidden component to listen to map zoom events and update the zoom level state.
 */
function MapZoomListener({ setZoomLevel }) {
    useMapEvents({
        zoomend: (event) => {
            setZoomLevel(event.target.getZoom());
        }
    });
    return null;
}

// Extracted styles for MapView component
const STYLES = {
    loading: {
        display: 'flex',
        height: '520px',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#64748b'
    },
    mapWrapper: {
        height: '520px',
        width: '100%',
        borderRadius: '12px',
        overflow: 'hidden',
        border: '1px solid #e2e8f0',
        position: 'relative',
        boxShadow: '0 2px 6px rgba(0,0,0,0.05)'
    },
    controlsContainer: {
        position: 'absolute',
        top: 12,
        right: 12,
        zIndex: 1000,
        display: 'flex',
        gap: '8px',
        alignItems: 'center'
    },
    buttonGroup: {
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        padding: '4px',
        borderRadius: '8px',
        boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
        display: 'flex',
        gap: '4px'
    },
    getButtonStyle: (isActive) => ({
        padding: '4px 10px',
        fontSize: '11px',
        fontWeight: 700,
        borderRadius: '6px',
        border: 'none',
        cursor: 'pointer',
        backgroundColor: isActive ? '#2563eb' : 'transparent',
        color: isActive ? '#ffffff' : '#475569'
    }),
    routesDropdownToggle: {
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
    },
    routesDropdownMenu: {
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
    },
    legend: {
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
    },
    legendItem: { display: 'flex', alignItems: 'center', gap: '6px' },
    getLegendDot: (color) => ({
        width: '12px',
        height: '12px',
        borderRadius: '50%',
        backgroundColor: color,
        border: '2px solid white',
        boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
    })
};

export default function MapView({ onSelectFacility, onOpenFacilityModal }) {
    const [facilities, setFacilities] = useState([]);
    const [transfers, setTransfers] = useState([]);
    const [mapStyle, setMapStyle] = useState('roadmap'); // 'roadmap' or 'satellite'
    const [isLoading, setIsLoading] = useState(true);
    const [zoomLevel, setZoomLevel] = useState(11.5);
    const [showRoutesDropdown, setShowRoutesDropdown] = useState(false);

    /**
     * Loads facilities and transfers data concurrently from the backend API.
     */
    const loadData = () => {
        Promise.all([getFacilities(), getTransfers()]).then(([facilityResponse, transferResponse]) => {
            if (facilityResponse && facilityResponse.type === 'FeatureCollection') {
                setFacilities(facilityResponse.features);
            }
            if (transferResponse && transferResponse.items) {
                setTransfers(transferResponse.items);
            }
            setIsLoading(false);
        });
    };

    // Load data on mount and subscribe to real-time network updates
    useEffect(() => {
        loadData();
        const unsubscribe = subscribeToNetworkUpdates(loadData);
        return () => unsubscribe();
    }, []);

    if (isLoading) {
        return (
            <div style={STYLES.loading}>
                Loading Google Maps background and supply routes...
            </div>
        );
    }

    // Default center point (Bengaluru)
    const defaultCenter = [12.9650, 77.6000];

    // Build geographic routes with coordinates, direction, units, and transit times
    const geographicRoutes = [];
    transfers.forEach(transfer => {
        if (transfer.status === 'in_transit' || transfer.status === 'pending') {
            const requestingFacility = facilities.find(facility => facility.properties.id === transfer.requesting_facility_id);
            transfer.matches.forEach(match => {
                if (match.match_status === 'accepted' || match.match_status === 'proposed') {
                    const supplyingFacility = facilities.find(facility => facility.properties.id === match.supplying_facility_id);
                    if (requestingFacility && supplyingFacility) {
                        const fromCoordinates = [supplyingFacility.geometry.coordinates[1], supplyingFacility.geometry.coordinates[0]];
                        const toCoordinates = [requestingFacility.geometry.coordinates[1], requestingFacility.geometry.coordinates[0]];
                        const midCoordinates = [(fromCoordinates[0] + toCoordinates[0]) / 2, (fromCoordinates[1] + toCoordinates[1]) / 2];

                        geographicRoutes.push({
                            transferId: transfer.id,
                            matchId: match.id,
                            isTransit: match.match_status === 'accepted',
                            fromCoords: fromCoordinates,
                            toCoords: toCoordinates,
                            midCoords: midCoordinates,
                            supplyingName: supplyingFacility.properties.name,
                            requestingName: requestingFacility.properties.name,
                            medicineName: transfer.medicine_name,
                            quantity: match.quantity_offered,
                            transitMinutes: match.estimated_transit_minutes,
                            distanceKm: match.distance_km,
                            status: transfer.status
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
        <div style={STYLES.mapWrapper}>
            {/* Map Controls: Map Style Toggle & Active Route Counter */}
            <div style={STYLES.controlsContainer}>
                <div style={STYLES.buttonGroup}>
                    <button
                        onClick={() => setMapStyle('roadmap')}
                        style={STYLES.getButtonStyle(mapStyle === 'roadmap')}
                    >
                        🗺️ Google Roads
                    </button>
                    <button
                        onClick={() => setMapStyle('satellite')}
                        style={STYLES.getButtonStyle(mapStyle === 'satellite')}
                    >
                        🛰️ Google Satellite
                    </button>
                </div>

                <div style={{ position: 'relative' }}>
                    <div 
                        onClick={() => setShowRoutesDropdown(!showRoutesDropdown)}
                        style={STYLES.routesDropdownToggle}
                    >
                        🚚 {geographicRoutes.length} Active Supply Routes
                    </div>
                    
                    {showRoutesDropdown && (
                        <div style={STYLES.routesDropdownMenu}>
                            <h4 style={{ margin: '0 0 10px 0', fontSize: '13px', color: '#0f172a' }}>Active Routes</h4>
                            {geographicRoutes.length === 0 ? (
                                <div style={{ fontSize: '12px', color: '#64748b' }}>No active routes.</div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    {geographicRoutes.map((route, index) => (
                                        <div key={`dropdown-route-${index}`} style={{ padding: '8px', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid #f1f5f9' }}>
                                            <div style={{ fontSize: '11px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                                                {route.supplyingName} ➔ {route.requestingName}
                                            </div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#64748b' }}>
                                                <span>{route.quantity}u {route.medicineName}</span>
                                                <span style={{ color: '#16a34a', fontWeight: 600 }}>{route.transitMinutes}m ETA</span>
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
            <div style={STYLES.legend}>
                <strong style={{ color: '#1d1d1f' }}>Legend:</strong>
                <div style={STYLES.legendItem}>
                    <div style={STYLES.getLegendDot('#ef4444')} />
                    <span style={{ color: '#1d1d1f', fontWeight: 500 }}>Critical</span>
                </div>
                <div style={STYLES.legendItem}>
                    <div style={STYLES.getLegendDot('#f59e0b')} />
                    <span style={{ color: '#1d1d1f', fontWeight: 500 }}>Warning</span>
                </div>
                <div style={STYLES.legendItem}>
                    <div style={STYLES.getLegendDot('#22c55e')} />
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
                {geographicRoutes.map((route, index) => (
                    <React.Fragment key={`geo-route-group-${route.transferId}-${index}`}>
                        {/* Outer Glow Polyline */}
                        <Polyline
                            positions={[route.fromCoords, route.toCoords]}
                            color={route.isTransit ? '#3b82f6' : '#f59e0b'}
                            weight={8}
                            opacity={0.3}
                        />

                        {/* Core Animated Route Polyline */}
                        <Polyline
                            positions={[route.fromCoords, route.toCoords]}
                            color={route.isTransit ? '#1d4ed8' : '#d97706'}
                            weight={4}
                            dashArray={route.isTransit ? '10, 8' : '6, 6'}
                            opacity={0.95}
                        >
                            <Tooltip sticky>
                                <div style={{ fontSize: '11px', lineHeight: 1.4 }}>
                                    <strong style={{ color: route.isTransit ? '#1d4ed8' : '#b45309' }}>
                                        {route.isTransit ? '🚚 SUPPLY IN TRANSIT' : '⏳ PROPOSED SUPPLY ROUTE'}
                                    </strong>
                                    <br />
                                    <strong>Origin:</strong> {route.supplyingName}<br />
                                    <strong>Destination:</strong> {route.requestingName}<br />
                                    <strong>Cargo:</strong> {route.medicineName} ({route.quantity} units)<br />
                                    <strong>Transit Time:</strong> {route.transitMinutes} mins ({route.distanceKm} km)
                                </div>
                            </Tooltip>
                        </Polyline>

                        {/* Permanent Midpoint Badge displaying Direction, Units and ETA */}
                        <Marker
                            position={route.midCoords}
                            icon={createRouteBadgeIcon(route, zoomLevel)}
                        >
                            <Popup minWidth={220}>
                                <div style={{ fontSize: '12px' }}>
                                    <div style={{ fontWeight: 'bold', color: '#1e293b', marginBottom: '4px' }}>
                                        Active Transfer #{route.transferId}
                                    </div>
                                    <div style={{ color: '#475569', marginBottom: '6px' }}>
                                        From: <strong>{route.supplyingName}</strong><br />
                                        To: <strong>{route.requestingName}</strong>
                                    </div>
                                    <div style={{ padding: '6px', background: '#eff6ff', borderRadius: '6px', color: '#1e40af', fontSize: '11px' }}>
                                        Cargo: <strong>{route.quantity} units</strong> of {route.medicineName}<br />
                                        Estimated arrival in <strong>{route.transitMinutes} mins</strong> ({route.distanceKm} km)
                                    </div>
                                </div>
                            </Popup>
                        </Marker>

                        {/* Destination Arrow Indicator at recipient coordinate */}
                        <Marker
                            position={route.toCoords}
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
                    const [longitude, latitude] = feature.geometry.coordinates;
                    const { id, name, type, worst_status, medicines } = feature.properties;

                    return (
                        <Marker
                            key={id}
                            position={[latitude, longitude]}
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
                                            {medicines.map(medicine => (
                                                <tr key={medicine.medicine_id}>
                                                    <td style={{ padding: '2px 0' }}>{medicine.medicine_name.split(' ')[0]}</td>
                                                    <td style={{ padding: '2px 0' }}>
                                                        {Math.round(medicine.current_stock)}u
                                                        <span
                                                            style={{
                                                                display: 'inline-block',
                                                                width: '7px',
                                                                height: '7px',
                                                                borderRadius: '50%',
                                                                backgroundColor: STATUS_COLORS[medicine.status],
                                                                marginLeft: '5px'
                                                            }}
                                                            title={medicine.status}
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