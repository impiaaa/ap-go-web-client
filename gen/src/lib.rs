use ::geo::{ClosestPoint, Coord, LineString, Point};
use rand::{Rng, SeedableRng};
use rstar::{PointDistance, RTree};
use std::collections::{HashMap, HashSet};
use std::panic;
use wasm_bindgen::prelude::*;
use web_sys::{console, js_sys};
mod geo;
use geo::{enu_to_geo, geo_ref_ecef_mat, geo_to_enu};

use crate::geo::Coord3d;

const DISTANCE_LENIENCY: f64 = 0.1;
const COLLECTION_DISTANCE_BASE: f64 = 20.0;
const GENERATED_DISTANCE_THRESHOLD_SQ: f64 = COLLECTION_DISTANCE_BASE * COLLECTION_DISTANCE_BASE;

#[wasm_bindgen(start)]
pub fn my_init_function() {
    panic::set_hook(Box::new(console_error_panic_hook::hook));
}

#[wasm_bindgen]
extern "C" {
    pub type OverpassResponse;

    #[wasm_bindgen(structural, method, getter)]
    pub fn elements(this: &OverpassResponse) -> Vec<OsmElement>;

    #[derive(Debug)]
    pub type OsmElement;
    #[wasm_bindgen(structural, method, getter)]
    pub fn r#type(this: &OsmElement) -> String;
    #[wasm_bindgen(structural, method, getter)]
    pub fn id(this: &OsmElement) -> f64;
    #[wasm_bindgen(structural, method, getter)]
    pub fn tags(this: &OsmElement) -> Option<JsValue>;

    #[derive(Debug)]
    #[wasm_bindgen(extends = OsmElement)]
    pub type OsmNode;
    #[wasm_bindgen(structural, method, getter)]
    pub fn lat(this: &OsmNode) -> f64;
    #[wasm_bindgen(structural, method, getter)]
    pub fn lon(this: &OsmNode) -> f64;

    #[derive(Debug)]
    #[wasm_bindgen(extends = OsmElement)]
    pub type OsmWay;
    #[wasm_bindgen(structural, method, getter)]
    pub fn nodes(this: &OsmWay) -> Vec<f64>;

    pub type GenerateParams;
    #[wasm_bindgen(structural, method, getter)]
    pub fn home(this: &GenerateParams) -> Vec<f64>;
    #[wasm_bindgen(structural, method, getter)]
    pub fn osm(this: &GenerateParams) -> OverpassResponse;
    #[wasm_bindgen(structural, method, getter)]
    pub fn seed_name(this: &GenerateParams) -> String;
    #[wasm_bindgen(structural, method, getter)]
    pub fn slot(this: &GenerateParams) -> f64;
    #[wasm_bindgen(structural, method, getter)]
    pub fn slot_data(this: &GenerateParams) -> APGoSlotData;

    pub type APGoSlotData;
    #[wasm_bindgen(method, getter)]
    pub fn goal(this: &APGoSlotData) -> Goal;
    #[wasm_bindgen(method, getter)]
    pub fn minimum_distance(this: &APGoSlotData) -> f64;
    #[wasm_bindgen(method, getter)]
    pub fn maximum_distance(this: &APGoSlotData) -> f64;
    #[wasm_bindgen(method, getter)]
    pub fn speed_requirement(this: &APGoSlotData) -> f64;
    #[wasm_bindgen(method, getter)]
    pub fn trips(this: &APGoSlotData) -> JsValue;

    pub type Trip;
    #[wasm_bindgen(method, getter)]
    pub fn distance_tier(this: &Trip) -> f64;
    #[wasm_bindgen(method, getter)]
    pub fn key_needed(this: &Trip) -> f64;
    #[wasm_bindgen(method, getter)]
    pub fn speed_tier(this: &Trip) -> f64;
}

#[wasm_bindgen]
#[derive(Copy, Clone, Debug)]
pub enum Goal {
    OneHardTravel = 0,
    Allsanity = 1,
    ShortMacGuffin = 2,
    LongMacGuffin = 3,
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct Internal {
    pub(crate) points_rtree: Option<RTree<Point>>,
    pub(crate) segments_rtree: Option<RTree<LineString>>,
}

#[wasm_bindgen(getter_with_clone)]
pub struct GenerateResults {
    pub success: bool,
    pub trip_points: js_sys::Map<JsValue, js_sys::Array<js_sys::Number>>,
    pub internal: Internal,
}

#[wasm_bindgen]
pub fn generate(params: &GenerateParams) -> GenerateResults {
    let mut results = GenerateResults {
        success: false,
        trip_points: js_sys::Map::new_typed(),
        internal: Internal {
            points_rtree: None,
            segments_rtree: None,
        },
    };
    let Ok(seed) = params
        .seed_name()
        .parse::<u128>()
        // 1e20 is the maximum as defined by seeddigits in BaseClasses.py
        // The multiply and divide brings it down from 1e20 range to u64::MAX range
        // Finally xor with the slot number so that different AP-Go participants in the same AP game
        // have different sets of trips
        .map(|x| ((x * 17592186044416 / 95367431640625) as u64) ^ (params.slot() as u64))
    else {
        return results;
    };
    let mut rng = rand::rngs::SmallRng::seed_from_u64(seed);
    let home: Coord = if params.home().len() == 2 {
        (params.home()[0], params.home()[1]).into()
    } else {
        return results;
    };
    let (ref_ecef, ecef_mat) = geo_ref_ecef_mat(home);
    let geo_mat = ecef_mat.transposed();

    let elements = params.osm().elements();
    let coords: HashMap<u64, Coord> = elements
        .iter()
        .filter_map(|el| {
            if el.r#type() == "node" {
                let node = el.unchecked_ref::<OsmNode>();
                let point_geo: Coord = (node.lon(), node.lat()).into();
                let point_enu = geo_to_enu(point_geo, ref_ecef, ecef_mat);
                Some((el.id() as u64, (point_enu.x, point_enu.y).into()))
            } else {
                None
            }
        })
        .collect();
    let ways: Vec<&OsmWay> = elements
        .iter()
        .filter_map(|el| {
            if el.r#type() == "way" {
                Some(el.unchecked_ref::<OsmWay>())
            } else {
                None
            }
        })
        .collect();

    let mut node_use_count: HashMap<u64, u32> = HashMap::new();
    for way in &ways {
        for node_id_float in way.nodes() {
            let node_id_int = node_id_float as u64;
            node_use_count.insert(
                node_id_int,
                node_use_count.get(&node_id_int).unwrap_or(&0u32) + 1,
            );
        }
    }

    let junction_nodes: HashSet<u64> = node_use_count
        .iter()
        .filter_map(
            |(node_id, count)| {
                if *count > 1u32 { Some(*node_id) } else { None }
            },
        )
        .collect();

    let mut segments: Vec<LineString> = Vec::new();
    for way in ways {
        let mut linestring: Vec<Coord> = Vec::new();
        for node_id_float in way.nodes() {
            let node_id_int = node_id_float as u64;
            if let Some(coord) = coords.get(&node_id_int) {
                linestring.push(*coord);
                if junction_nodes.contains(&node_id_int) {
                    if linestring.len() >= 2 {
                        segments.push(LineString::from(linestring));
                    }
                    linestring = vec![*coord];
                }
            }
        }
        if linestring.len() >= 2 {
            segments.push(LineString::from(linestring));
        }
    }

    let segments_tree = RTree::bulk_load(segments);
    let mut points_tree = RTree::<Point>::new();

    let mut min_dist = params.slot_data().minimum_distance();
    if min_dist > params.slot_data().maximum_distance() {
        min_dist = params.slot_data().maximum_distance() * (1.0 - DISTANCE_LENIENCY);
    }

    if let Ok(trip_names) = js_sys::Reflect::own_keys(&params.slot_data().trips()) {
        for trip_name in trip_names {
            let trip: Trip = js_sys::Reflect::get(&params.slot_data().trips(), &trip_name)
                .unwrap()
                .unchecked_into();

            let mut max_dist =
                (params.slot_data().maximum_distance() / 10.0) * trip.distance_tier();
            if max_dist < params.slot_data().minimum_distance() {
                max_dist = params.slot_data().minimum_distance() * (1.0 + DISTANCE_LENIENCY);
            }

            let mut attempt = 1;
            const MAX_ATTEMPTS: i32 = 256;
            loop {
                console::log_1(
                    &format!(
                        "Attempt {attempt}: Generating random point with radius between {min_dist} and {max_dist}"
                    )
                    .into(),
                );

                let r = (max_dist - min_dist) * rng.r#gen::<f64>().sqrt() + min_dist;
                let theta = rng.r#gen::<f64>() * std::f64::consts::TAU;
                let (st, ct) = theta.sin_cos();
                let random_point = ::geo::Point::new(r * ct, r * st);
                console::log_1(&format!("Random point is {random_point:?}").into());

                // Don't generate points too close to each other, but at a lower priority than
                // checking for nearby segments
                if attempt < MAX_ATTEMPTS / 2
                    && let Some(nearest_other_point) = points_tree.nearest_neighbor(&random_point)
                    && random_point.distance_2(nearest_other_point)
                        < GENERATED_DISTANCE_THRESHOLD_SQ
                {
                    continue;
                }

                let Some(nearest_segment) = segments_tree.nearest_neighbor(&random_point) else {
                    // empty tree?
                    return results;
                };
                let nearest_point_on_segment = match nearest_segment.closest_point(&random_point) {
                    ::geo::Closest::Indeterminate => continue,
                    ::geo::Closest::Intersection(point) => point,
                    ::geo::Closest::SinglePoint(point) => point,
                };
                let distance_to_nearest_point_sq =
                    random_point.distance_2(&nearest_point_on_segment);
                if distance_to_nearest_point_sq < GENERATED_DISTANCE_THRESHOLD_SQ
                    || attempt >= MAX_ATTEMPTS
                {
                    let selected_point = if attempt < MAX_ATTEMPTS {
                        random_point
                    } else {
                        console::log_1(
                            &format!("Out of attempts, snapping to {nearest_point_on_segment:?}")
                                .into(),
                        );
                        nearest_point_on_segment
                    };
                    points_tree.insert(selected_point);
                    // TODO: Route from here to home:
                    // - Snap home point to network, include that distance in route length
                    // - Reroll if point isn't routable or if route is shorter than min_dist
                    // - Trim route to selected distance, use that new end point
                    let enu_coord = Coord3d {
                        x: selected_point.x(),
                        y: selected_point.y(),
                        z: 0.0,
                    };
                    let geo_coord = enu_to_geo(enu_coord, ref_ecef, geo_mat);
                    let arr: js_sys::Array<js_sys::Number> =
                        js_sys::Array::new_with_length_typed(2);
                    arr.set(0, geo_coord.x.into());
                    arr.set(1, geo_coord.y.into());
                    results.trip_points.set(&trip_name, &arr);
                    break;
                }
                attempt += 1;
            }
        }
    }

    results.internal.segments_rtree = Some(segments_tree);
    results.internal.points_rtree = Some(points_tree);
    results.success = true;

    results
}
