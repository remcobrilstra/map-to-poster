import L from 'leaflet';
import maplibregl from 'maplibre-gl';
import { state, updateState } from '../core/state.js';
import { markerIcons } from '../core/marker-icons.js';
import { findBestInsertIndex } from '../core/utils.js';
import { updateRouteGeometry, syncRouteMarkers } from './route-manager.js';
import { generateMapLibreStyle } from './artistic-style.js';
import { clearMarkers } from './marker-manager.js';

let map = null;
let tileLayer = null;
let artisticMap = null;
let currentArtisticThemeName = null;
let isSyncing = false;
let styleChangeInProgress = false;
let pendingArtisticStyle = null;
let pendingArtisticThemeName = null;
let borderLayer = null;
let currentBorderGeojson = null;
let currentBorderStyle = { color: '#3b82f6', fill: true, lineStyle: 'dashed' };

export const getMap = () => map;
export const getArtisticMap = () => artisticMap;

export function initMap(containerId, initialCenter, initialZoom, initialTileUrl) {
	map = L.map(containerId, {
		zoomControl: false,
		attributionControl: false,
		scrollWheelZoom: 'center',
		touchZoom: 'center'
	}).setView(initialCenter, initialZoom);

	tileLayer = L.tileLayer(initialTileUrl, {
		maxZoom: 19,
		crossOrigin: true,
	}).addTo(map);

	map.on('moveend', () => {
		if (isSyncing) return;
		isSyncing = true;

		const center = map.getCenter();
		const zoom = map.getZoom();
		updateState({
			lat: center.lat,
			lon: center.lng,
			zoom: zoom
		});

		if (artisticMap) {
			artisticMap.jumpTo({
				center: [center.lng, center.lat],
				zoom: zoom - 1
			});
		}

		isSyncing = false;
	});

	initArtisticMap('artistic-map', [initialCenter[1], initialCenter[0]], initialZoom - 1);

	if (state.showRoute) {
		updateRouteGeometry();
	}

	return map;
}

function initArtisticMap(containerId, center, zoom) {
	artisticMap = new maplibregl.Map({
		container: containerId,
		style: { version: 8, sources: {}, layers: [] },
		center: center,
		zoom: zoom,
		interactive: true,
		attributionControl: false,
		preserveDrawingBuffer: true
	});

	artisticMap.scrollZoom.setWheelZoomRate(1);
	artisticMap.scrollZoom.setZoomRate(1 / 600);

	artisticMap.on('style.load', () => {
		if (pendingArtisticStyle) {
			const next = pendingArtisticStyle;
			const nextName = pendingArtisticThemeName;
			pendingArtisticStyle = null;
			pendingArtisticThemeName = null;
			currentArtisticThemeName = nextName;
			artisticMap.setStyle(next);
		} else {
			styleChangeInProgress = false;
			if (currentBorderGeojson) {
				_applyArtisticBorder(currentBorderGeojson);
			}
		}
	});

	artisticMap.on('moveend', () => {
		if (isSyncing) return;
		isSyncing = true;

		const center = artisticMap.getCenter();
		const zoom = artisticMap.getZoom();

		updateState({
			lat: center.lat,
			lon: center.lng,
			zoom: zoom + 1
		});

		if (map) {
			map.setView([center.lat, center.lng], zoom + 1, { animate: false });
		}

		isSyncing = false;
	});

	artisticMap.on('mousedown', 'route-line', (e) => {
		e.preventDefault();
		const startPos = e.point;
		let pointAdded = false;
		let index = -1;

		isSyncing = true;
		artisticMap.dragPan.disable();

		const onMouseMove = (me) => {
			const currentPos = me.point;
			const dist = Math.sqrt(Math.pow(currentPos.x - startPos.x, 2) + Math.pow(currentPos.y - startPos.y, 2));

			if (!pointAdded && dist > 5) {
				const via = [...(state.routeViaPoints || [])];
				const routePoints = [
					{ lat: state.routeStartLat, lon: state.routeStartLon },
					...via,
					{ lat: state.routeEndLat, lon: state.routeEndLon }
				];
				index = findBestInsertIndex(me.lngLat.lat, me.lngLat.lng, routePoints);
				via.splice(index, 0, { lat: me.lngLat.lat, lon: me.lngLat.lng });
				updateState({ routeViaPoints: via });
				pointAdded = true;
			}

			if (pointAdded && index !== -1) {
				const v = [...state.routeViaPoints];
				v[index] = { lat: me.lngLat.lat, lon: me.lngLat.lng };
				updateState({ routeViaPoints: v });
				syncRouteMarkers(false);
			}
		};

		const onMouseUp = () => {
			artisticMap.off('mousemove', onMouseMove);
			artisticMap.off('mouseup', onMouseUp);
			artisticMap.dragPan.enable();
			isSyncing = false;
			if (pointAdded) {
				updateRouteGeometry();
			}
		};

		artisticMap.on('mousemove', onMouseMove);
		artisticMap.on('mouseup', onMouseUp);
	});

	artisticMap.on('mouseenter', 'route-line', () => {
		artisticMap.getCanvas().style.cursor = 'crosshair';
	});

	artisticMap.on('mouseleave', 'route-line', () => {
		artisticMap.getCanvas().style.cursor = '';
	});
}

// ─── Location Border ────────────────────────────────────────────────────────

function _applyArtisticBorder(geojson) {
	if (!artisticMap || !geojson) return;
	const { color, fill, lineStyle } = currentBorderStyle;
	const fillOpacity = fill ? 0.08 : 0;
	const dasharray = lineStyle === 'dashed' ? [4, 4] : [1, 0];
	try {
		const src = artisticMap.getSource('location-border');
		if (src) {
			src.setData(geojson);
			if (artisticMap.getLayer('location-border-fill')) {
				artisticMap.setPaintProperty('location-border-fill', 'fill-color', color);
				artisticMap.setPaintProperty('location-border-fill', 'fill-opacity', fillOpacity);
			}
			if (artisticMap.getLayer('location-border-line')) {
				artisticMap.setPaintProperty('location-border-line', 'line-color', color);
				artisticMap.setPaintProperty('location-border-line', 'line-dasharray', dasharray);
			}
		} else {
			artisticMap.addSource('location-border', { type: 'geojson', data: geojson });
			artisticMap.addLayer({
				id: 'location-border-fill',
				type: 'fill',
				source: 'location-border',
				paint: { 'fill-color': color, 'fill-opacity': fillOpacity }
			});
			artisticMap.addLayer({
				id: 'location-border-line',
				type: 'line',
				source: 'location-border',
				paint: { 'line-color': color, 'line-width': 2, 'line-dasharray': dasharray }
			});
		}
	} catch (e) { /* ignore if map not ready */ }
}

function _clearArtisticBorder() {
	if (!artisticMap) return;
	try {
		if (artisticMap.getLayer('location-border-line')) artisticMap.removeLayer('location-border-line');
		if (artisticMap.getLayer('location-border-fill')) artisticMap.removeLayer('location-border-fill');
		if (artisticMap.getSource('location-border')) artisticMap.removeSource('location-border');
	} catch (e) { /* ignore */ }
}

/**
 * Fit the map view to a bounding box (from Nominatim: [southLat, northLat, westLon, eastLon]).
 * When lat/lon are provided the map navigates to that exact point at the bbox-derived zoom
 * level, rather than the bbox centre.
 * @param {number[]} bbox
 * @param {number} [lat]
 * @param {number} [lon]
 * @param {{ matEnabled?: boolean, matWidth?: number, posterWidth?: number, posterHeight?: number }} [matOpts]
 */
export function fitLocationBounds(bbox, lat, lon, matOpts = {}) {
	if (!map || !bbox) return;
	const [south, north, west, east] = bbox.map(Number);
	const bounds = L.latLngBounds([[south, west], [north, east]]);

	let padPx = 30;
	if (matOpts.matEnabled && matOpts.matWidth > 0) {
		const mapSize = map.getSize();
		const { matWidth = 40, posterWidth = 1080, posterHeight = 1080 } = matOpts;
		const matRatioX = matWidth / posterWidth;
		const matRatioY = matWidth / posterHeight;
		const padX = Math.round(matRatioX * mapSize.x);
		const padY = Math.round(matRatioY * mapSize.y);
		padPx = Math.max(padX, padY) + 20;
	}

	const zoom = Math.min(map.getBoundsZoom(bounds, false, L.point(padPx * 2, padPx * 2)), 16);
	if (lat !== undefined && lon !== undefined) {
		map.setView([lat, lon], zoom, { animate: true });
	} else {
		map.fitBounds(bounds, { padding: [padPx, padPx], maxZoom: 16, animate: true });
	}
}

/**
 * Render a GeoJSON polygon as a city border overlay on both maps.
 * @param {object} geojson
 * @param {{ color?: string, fill?: boolean, lineStyle?: 'solid'|'dashed' }} [style]
 */
export function setLocationBorder(geojson, style) {
	if (style) currentBorderStyle = { ...currentBorderStyle, ...style };
	clearLocationBorder();
	if (!geojson) return;
	currentBorderGeojson = geojson;

	const { color, fill, lineStyle } = currentBorderStyle;
	const fillOpacity = fill ? 0.08 : 0;
	const dashArray = lineStyle === 'dashed' ? '6 5' : null;

	// Leaflet overlay
	if (map) {
		borderLayer = L.geoJSON(geojson, {
			style: {
				color,
				weight: 2,
				opacity: 0.85,
				fillColor: color,
				fillOpacity,
				...(dashArray ? { dashArray } : {}),
				className: 'location-border-layer'
			}
		}).addTo(map);
	}

	// MapLibre artistic overlay
	_applyArtisticBorder(geojson);
}

/**
 * Update border appearance without re-fetching the polygon.
 * @param {{ color?: string, fill?: boolean, lineStyle?: 'solid'|'dashed' }} style
 */
export function updateLocationBorderStyle(style) {
	if (!currentBorderGeojson) return;
	currentBorderStyle = { ...currentBorderStyle, ...style };
	setLocationBorder(currentBorderGeojson);
}

/** Remove the city border overlay from both maps. */
export function clearLocationBorder() {
	if (borderLayer) {
		borderLayer.remove();
		borderLayer = null;
	}
	currentBorderGeojson = null;
	_clearArtisticBorder();
}

// ─── Artistic Style ──────────────────────────────────────────────────────────

export function updateArtisticStyle(theme) {
	if (!artisticMap) return;
	if (currentArtisticThemeName === theme.name) return;

	currentArtisticThemeName = theme.name;
	const style = generateMapLibreStyle(theme);

	if (styleChangeInProgress) {
		pendingArtisticStyle = style;
		pendingArtisticThemeName = theme.name;
		try { artisticMap.setStyle(style); } catch (e) { }
		return;
	}

	styleChangeInProgress = true;
	try {
		artisticMap.setStyle(style);
	} catch (e) {
		pendingArtisticStyle = style;
		pendingArtisticThemeName = theme.name;
	}
}

export function updateMapPosition(lat, lon, zoom, options = { animate: true }) {
	if (map) {
		if (lat !== undefined && lon !== undefined) {
			map.setView([lat, lon], zoom || map.getZoom(), options);
		} else if (zoom !== undefined) {
			map.setZoom(zoom, options);
		}
	}
}

export function updateMapTheme(tileUrl) {
	if (tileLayer) {
		tileLayer.setUrl(tileUrl);
	}
}

export function waitForTilesLoad(timeout = 30000) {
	return new Promise((resolve) => {
		if (!map || !tileLayer) return resolve();
		try {
			if (tileLayer._tiles) {
				const tiles = Object.values(tileLayer._tiles || {});
				const anyLoading = tiles.some(t => {
					const el = t.el || t.tile || (t._el);
					return el && el.complete === false;
				});
				if (!anyLoading) return resolve();
			}
		} catch (e) { }

		let resolved = false;
		const onLoad = () => { if (!resolved) { resolved = true; clearTimeout(timer); resolve(); } };
		tileLayer.once('load', onLoad);
		const timer = setTimeout(() => { if (!resolved) { resolved = true; resolve(); } }, timeout);
	});
}

export function waitForArtisticIdle(timeout = 30000) {
	return new Promise((resolve) => {
		if (!artisticMap) return resolve();
		let resolved = false;
		const onIdle = () => { if (!resolved) { resolved = true; clearTimeout(timer); resolve(); } };
		try { artisticMap.once('idle', onIdle); } catch (e) { resolve(); return; }
		const timer = setTimeout(() => { if (!resolved) { resolved = true; resolve(); } }, timeout);
	});
}

export function getMapInstance() { return map; }
export function getArtisticMapInstance() { return artisticMap; }

export function invalidateMapSize() {
	if (map) map.invalidateSize({ animate: false });
	if (artisticMap) artisticMap.resize();
}

export { updateRouteStyles, syncRouteMarkers, updateRouteGeometry } from './route-manager.js';
export { updateMarkerStyles, updateMarkerIcon, updateMarkerSize, updateMarkerVisibility, updateMarkerPosition } from './marker-manager.js';

