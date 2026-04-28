use ::geo::{ClosestPoint, Coord, Length, LineString, Point};
use rand::{Rng, SeedableRng};
use rstar::primitives::GeomWithData;
use rstar::{PointDistance, RTree};
use std::collections::{HashMap, HashSet};
use std::panic;
use wasm_bindgen::prelude::*;
use web_sys::{console, js_sys};
mod geo;
use geo::{enu_to_geo, geo_ref_ecef_mat, geo_to_enu};

use crate::geo::{AffineTransform3d, Coord3d};

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
    pub fn tags(this: &OsmElement) -> Option<js_sys::Object>;

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
    pub fn locations(this: &GenerateParams) -> js_sys::Map<js_sys::Number, js_sys::JsString>;
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
    pub fn trips(this: &APGoSlotData) -> js_sys::Object;

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
    pub(crate) points_rtree: Option<RTree<GeomWithData<Point, i64>>>,
    pub(crate) ref_ecef: Option<Coord3d>,
    pub(crate) ecef_mat: Option<AffineTransform3d>,
}

fn distance_tier_to_maximum_distance(distance_tier: f64, slot_data: &APGoSlotData) -> f64 {
    let max_dist = (slot_data.maximum_distance() / 10.0) * distance_tier;
    if max_dist < slot_data.minimum_distance() {
        slot_data.minimum_distance() * (1.0 + DISTANCE_LENIENCY)
    } else {
        max_dist
    }
}

#[wasm_bindgen]
pub fn generate(
    params: &GenerateParams,
) -> Result<js_sys::Map<js_sys::Number, js_sys::Array<js_sys::Number>>, &'static str> {
    let Ok(seed) = params
        .seed_name()
        .parse::<u128>()
        // 1e20 is the maximum as defined by seeddigits in BaseClasses.py
        // The multiply and divide brings it down from 1e20 range to u64::MAX range
        // Finally xor with the slot number so that different AP-Go participants in the same AP game
        // have different sets of trips
        .map(|x| ((x * 17592186044416 / 95367431640625) as u64) ^ (params.slot() as u64))
    else {
        return Err("Couldn't parse seed");
    };
    let mut rng = rand::rngs::SmallRng::seed_from_u64(seed);
    let home: Coord = if params.home().len() == 2 {
        (params.home()[0], params.home()[1]).into()
    } else {
        return Err("Couldn't parse home");
    };
    let (ref_ecef, ecef_mat) = geo_ref_ecef_mat(home);
    let geo_mat = ecef_mat.transposed();
    console::log_1(&format!("ref_ecef={ref_ecef:?}").into());
    console::log_1(&format!("ecef_mat={ecef_mat:?}").into());
    console::log_1(&format!("geo_mat={geo_mat:?}").into());

    let mut min_dist = params.slot_data().minimum_distance();
    if min_dist > params.slot_data().maximum_distance() {
        min_dist = params.slot_data().maximum_distance() * (1.0 - DISTANCE_LENIENCY);
    }

    let mut max_dist_tier_number_locations_per_area = HashMap::<u8, (f64, usize)>::new();
    for trip_js in js_sys::Object::values(&params.slot_data().trips()) {
        let trip = trip_js.unchecked_ref::<Trip>();
        let area = trip.key_needed() as u8;
        let distance = trip.distance_tier();

        max_dist_tier_number_locations_per_area.insert(
            area,
            max_dist_tier_number_locations_per_area
                .get(&area)
                .map(|(max_dist, count)| (max_dist.max(distance), count + 1))
                .unwrap_or((distance, 1)),
        );
    }
    for (area, (distance, count)) in max_dist_tier_number_locations_per_area.iter() {
        console::log_1(&format!("Area {area}: {count} trips at most tier {distance}").into());
    }

    let random_point_per_area: HashMap<u8, ::geo::Point> = max_dist_tier_number_locations_per_area
        .iter()
        .map(|(area, (max_dist_tier, _count))| {
            // do not seed areas outside the maximum radius of that area
            (
                *area,
                random_point_in_circle(
                    min_dist,
                    distance_tier_to_maximum_distance(*max_dist_tier, &params.slot_data()),
                    &mut rng,
                ),
            )
        })
        .collect();

    let mut way_linestrings = Vec::<(u64, u64, LineString)>::new();
    let elements = params.osm().elements();
    {
        console::log_1(&format!("{} elements", elements.len()).into());
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
        console::log_1(&format!("{} nodes", coords.len()).into());
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
        console::log_1(&format!("{} ways", ways.len()).into());

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
        console::log_1(&format!("{} junction nodes", junction_nodes.len()).into());

        for way in ways {
            let mut segment_coords: Vec<Coord> = Vec::new();
            let mut first_node: u64 = way.nodes()[0] as u64;
            for node_id_float in way.nodes() {
                let node_id_int = node_id_float as u64;
                if let Some(coord) = coords.get(&node_id_int) {
                    segment_coords.push(*coord);
                    if junction_nodes.contains(&node_id_int) {
                        if segment_coords.len() >= 2 {
                            way_linestrings.push((
                                first_node,
                                node_id_int,
                                LineString::from(segment_coords),
                            ));
                        }
                        segment_coords = vec![*coord];
                        first_node = node_id_int;
                    }
                }
            }
            if segment_coords.len() >= 2 {
                way_linestrings.push((
                    first_node,
                    *way.nodes().last().unwrap() as u64,
                    LineString::from(segment_coords),
                ));
            }
        }
        console::log_1(&format!("{} linestrings", way_linestrings.len()).into());
    }

    let mut graph = petgraph::graph::Graph::<u64, f64, petgraph::Undirected>::new_undirected();
    let mut osm_id_to_graph_id: HashMap<u64, petgraph::graph::NodeIndex> = elements
        .iter()
        .filter_map(|el| {
            if el.r#type() == "node" {
                let node = el.unchecked_ref::<OsmNode>();
                let node_int = node.id() as u64;
                Some((node_int, graph.add_node(node_int)))
            } else {
                None
            }
        })
        .collect();
    console::log_1(&format!("{} nodes", graph.node_count()).into());
    {
        for (start_node, end_node, linestring) in &way_linestrings {
            graph.add_edge(
                *osm_id_to_graph_id.get(start_node).unwrap(),
                *osm_id_to_graph_id.get(end_node).unwrap(),
                ::geo::algorithm::line_measures::Euclidean.length(linestring),
            );
        }
        console::log_1(&format!("{} edges", graph.edge_count()).into());

        let sccs = petgraph::algo::kosaraju_scc(&graph);
        let max_scc = sccs
            .iter()
            .max_by(|c1, c2| c1.len().cmp(&c2.len()))
            .unwrap();
        console::log_1(&format!("Largest connected component has {} nodes", max_scc.len()).into());

        let max_scc_hashset: HashSet<&petgraph::graph::NodeIndex> = max_scc.iter().collect();
        graph.retain_nodes(|_, ni| max_scc_hashset.contains(&ni));
        console::log_1(&format!("Edge count now {}", graph.edge_count()).into());
        console::log_1(&format!("Node count now {}", graph.node_count()).into());

        osm_id_to_graph_id.retain(|_osm_id, graph_id| max_scc_hashset.contains(graph_id));
        console::log_1(&format!("Lookup size={}", osm_id_to_graph_id.len()).into());
    }

    let mut segments_tree = RTree::<LineString>::new();
    for (start_node, end_node, linestring) in way_linestrings {
        if osm_id_to_graph_id.contains_key(&start_node)
            && osm_id_to_graph_id.contains_key(&end_node)
        {
            segments_tree.insert(linestring);
        }
    }
    if segments_tree.size() == 0 {
        return Err("No segments");
    }
    console::log_1(&format!("{} segments in tree", segments_tree.size()).into());

    let mut points_tree = RTree::<GeomWithData<Point, i64>>::new();
    let trip_points: js_sys::Map<js_sys::Number, js_sys::Array<js_sys::Number>> =
        js_sys::Map::new_typed();

    params.locations().for_each(&mut |trip_name, location_id| {
        let trip: Trip = js_sys::Reflect::get(&params.slot_data().trips(), &trip_name)
            .unwrap()
            .unchecked_into();

        let max_dist = distance_tier_to_maximum_distance(trip.distance_tier(), &params.slot_data());

        let mut attempt = 1;
        const MAX_ATTEMPTS: i32 = 256;
        loop {
            console::log_1(
                &format!(
                    "Attempt {attempt}: Generating random point with radius between {min_dist} and {max_dist}"
                )
                .into(),
            );

            let random_point = random_point_in_circle(min_dist, max_dist, &mut rng);
            console::log_1(&format!("Random point is {random_point:?}").into());

            // Don't generate points too close to each other, but at a lower priority than
            // checking for nearby segments
            if attempt < MAX_ATTEMPTS / 2
                && let Some(nearest_other_point) = points_tree.nearest_neighbor(&random_point)
                && random_point.distance_2(nearest_other_point.geom())
                    < GENERATED_DISTANCE_THRESHOLD_SQ
            {
                continue;
            }

            let Some(nearest_segment) = segments_tree.nearest_neighbor(&random_point) else {
                // empty tree?
                return;
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
                points_tree.insert(GeomWithData::new(
                    selected_point,
                    location_id.as_f64().unwrap() as i64,
                ));
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
                trip_points.set(&location_id, &arr);
                break;
            }
            attempt += 1;
        }
    });

    Ok(trip_points)
}

fn random_point_in_circle<T: Rng, U: ::geo::CoordFloat + num_traits::FloatConst>(
    min_dist: U,
    max_dist: U,
    rng: &mut T,
) -> ::geo::Point<U>
where
    rand::distributions::Standard: rand::distributions::Distribution<U>,
{
    let r = (max_dist - min_dist) * rng.r#gen::<U>().sqrt() + min_dist;
    let theta = rng.r#gen::<U>() * U::TAU();
    let (st, ct) = theta.sin_cos();
    ::geo::Point::<U>::new(r * ct, r * st)
}

#[wasm_bindgen]
pub fn set_up_with_saved_points(
    home_vec: Vec<f64>,
    points: js_sys::Map<js_sys::Number, js_sys::Array<js_sys::Number>>,
) -> Internal {
    let home: Coord = (home_vec[0], home_vec[1]).into();
    let (ref_ecef, ecef_mat) = geo_ref_ecef_mat(home);

    let points_tree = RTree::<GeomWithData<Point, i64>>::bulk_load(
        points
            .keys()
            .into_iter()
            .flatten()
            .map(|location_id| {
                let v = points.get(&location_id);
                let enu_coord = geo_to_enu(
                    (v.get(0).as_f64().unwrap(), v.get(1).as_f64().unwrap()).into(),
                    ref_ecef,
                    ecef_mat,
                );
                GeomWithData::new(
                    (enu_coord.x, enu_coord.y).into(),
                    location_id.as_f64().unwrap() as i64,
                )
            })
            .collect(),
    );

    Internal {
        points_rtree: Some(points_tree),
        ref_ecef: Some(ref_ecef),
        ecef_mat: Some(ecef_mat),
    }
}

fn _points_in_radius(
    internal: &Internal,
    point_arr: js_sys::Array<js_sys::Number>,
    distance: f64,
) -> Result<Vec<i64>, ()> {
    let coord_geo: Coord = (
        point_arr.get(0).as_f64().ok_or(())?,
        point_arr.get(1).as_f64().ok_or(())?,
    )
        .into();
    let coord_enu = geo_to_enu(
        coord_geo,
        internal.ref_ecef.ok_or(())?,
        internal.ecef_mat.ok_or(())?,
    );
    let point_enu: Point = (coord_enu.x, coord_enu.y).into();
    if let Some(points_tree) = &internal.points_rtree {
        Ok(points_tree
            .locate_within_distance(point_enu, distance * distance)
            .map(|p| p.data)
            .collect())
    } else {
        Err(())
    }
}

#[wasm_bindgen]
pub fn points_in_radius(
    internal: &Internal,
    point_arr: js_sys::Array<js_sys::Number>,
    distance: f64,
) -> JsValue {
    if let Ok(res) = _points_in_radius(internal, point_arr, distance) {
        let ret: js_sys::Array<JsValue> =
            res.iter().map(|i| JsValue::from_f64(*i as f64)).collect();
        ret.into()
    } else {
        JsValue::null()
    }
}

#[wasm_bindgen]
pub fn make_circle(
    internal: &Internal,
    point_arr: Vec<f64>,
    radius: f64,
    points: u64,
) -> Vec<JsValue> {
    let center_geo: Coord = (point_arr[0], point_arr[1]).into();
    let center_enu = geo_to_enu(
        center_geo,
        internal.ref_ecef.unwrap(),
        internal.ecef_mat.unwrap(),
    );
    let geo_mat = internal.ecef_mat.unwrap().transposed();
    (0..points + 1)
        .map(|i| {
            let theta = std::f64::consts::TAU * (i as f64) / (points as f64);
            let (sc, cs) = theta.sin_cos();
            let point_enu = Coord3d {
                x: cs * radius + center_enu.x,
                y: sc * radius + center_enu.y,
                z: center_enu.z,
            };
            let point_geo = enu_to_geo(point_enu, internal.ref_ecef.unwrap(), geo_mat);
            vec![
                JsValue::from_f64(point_geo.x),
                JsValue::from_f64(point_geo.y),
            ]
            .into()
        })
        .collect()
}
