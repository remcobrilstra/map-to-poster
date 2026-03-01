export async function searchLocation(query, opts = {}) {
	if (!query || query.length < 2) return [];

	const { limit = 15, signal } = opts;

	try {
		const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=${limit}&addressdetails=1`;
		const response = await fetch(url, { signal, headers: { 'Accept': 'application/json' } });
		const data = await response.json();

		return data.map(item => ({
			name: item.display_name,
			lat: parseFloat(item.lat),
			lon: parseFloat(item.lon),
			shortName: item.name || (item.display_name && item.display_name.split(',')[0]) || item.display_name,
			country: item.address ? item.address.country : '',
			// [southLat, northLat, westLon, eastLon]
			boundingbox: item.boundingbox ? item.boundingbox.map(parseFloat) : null,
			osmType: item.osm_type || null,
			osmId: item.osm_id || null,
		}));
	} catch (error) {
		if (error && error.name === 'AbortError') {
			return [];
		}
		console.error("Geocoding error:", error);
		return [];
	}
}

/**
 * Fetch the GeoJSON boundary polygon for a location via the Nominatim lookup API.
 * @param {string} osmType  - 'node', 'way', or 'relation'
 * @param {string|number} osmId
 * @returns {Promise<object|null>} GeoJSON geometry or null
 */
export async function fetchLocationPolygon(osmType, osmId) {
	if (!osmType || !osmId) return null;
	const typeChar = osmType[0].toUpperCase(); // N, W, R
	const url = `https://nominatim.openstreetmap.org/lookup?osm_ids=${typeChar}${osmId}&polygon_geojson=1&format=json`;
	try {
		const response = await fetch(url, { headers: { 'Accept': 'application/json' } });
		const data = await response.json();
		if (Array.isArray(data) && data[0] && data[0].geojson) {
			return data[0].geojson;
		}
		return null;
	} catch (error) {
		console.error('Error fetching location polygon:', error);
		return null;
	}
}

export function formatCoords(lat, lon) {
	const latDir = lat >= 0 ? 'N' : 'S';
	const lonDir = lon >= 0 ? 'E' : 'W';

	return `${Math.abs(lat).toFixed(4)}° ${latDir}, ${Math.abs(lon).toFixed(4)}° ${lonDir}`;
}
