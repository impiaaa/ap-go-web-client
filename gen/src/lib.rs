use ::geo::{ClosestPoint, Coord, Length, LineLocatePoint, LineString, Point};
use rand::{Rng, SeedableRng};
use rstar::primitives::GeomWithData;
use rstar::{PointDistance, RTree};
use std::collections::{HashMap, HashSet};
use std::panic;
use wasm_bindgen::prelude::*;
use web_sys::js_sys;
mod geo;
use geo::{enu_to_geo, geo_ref_ecef_mat, geo_to_enu};
mod osm_types;

use crate::geo::{AffineTransform3d, Coord3d};

const DISTANCE_LENIENCY_M: f64 = 0.1;
const COLLECTION_DISTANCE_BASE_M: f64 = 20.0;
const GENERATED_DISTANCE_THRESHOLD_M_2: f64 =
    COLLECTION_DISTANCE_BASE_M * COLLECTION_DISTANCE_BASE_M;

#[wasm_bindgen(start)]
pub fn my_init_function() {
    panic::set_hook(Box::new(console_error_panic_hook::hook));
}

#[wasm_bindgen]
extern "C" {
    #[derive(Clone)]
    pub type OverpassResponse;

    #[wasm_bindgen(structural, method, getter)]
    pub fn elements(this: &OverpassResponse) -> Vec<JsOsmElement>;

    #[derive(Debug)]
    pub type JsOsmElement;
    #[wasm_bindgen(structural, method, getter)]
    pub fn r#type(this: &JsOsmElement) -> String;
    #[wasm_bindgen(structural, method, getter)]
    pub fn id(this: &JsOsmElement) -> f64;
    #[wasm_bindgen(structural, method, getter)]
    pub fn tags(this: &JsOsmElement) -> Option<js_sys::Object>;

    #[derive(Debug)]
    #[wasm_bindgen(extends = JsOsmElement)]
    pub type JsOsmNode;
    #[wasm_bindgen(structural, method, getter)]
    pub fn lat(this: &JsOsmNode) -> f64;
    #[wasm_bindgen(structural, method, getter)]
    pub fn lon(this: &JsOsmNode) -> f64;

    #[derive(Debug)]
    #[wasm_bindgen(extends = JsOsmElement)]
    pub type JsOsmWay;
    #[wasm_bindgen(structural, method, getter)]
    pub fn nodes(this: &JsOsmWay) -> Vec<f64>;

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
    #[wasm_bindgen(structural, method, getter)]
    pub fn subgraph_selection(this: &GenerateParams) -> SubgraphSelection;

    #[derive(Clone)]
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

#[wasm_bindgen]
#[derive(Copy, Clone, Debug, PartialEq)]
pub enum SubgraphSelection {
    FullGraph,
    BiggestSubgraph,
    ClosestSubgraph,
}

#[cfg(target_family = "wasm")]
macro_rules! console_log {
    ($($t:tt)*) => (web_sys::console::log_1(&format!($($t)*).into()))
}
#[cfg(not(target_family = "wasm"))]
macro_rules! console_log {
    ($($t:tt)*) => (println!($($t)*))
}

type SegmentsTree = RTree<GeomWithData<LineString, (i64, i64)>>;

fn distance_tier_to_maximum_distance(distance_tier: f64, slot_data: &APGoSlotData) -> f64 {
    let max_dist = (slot_data.maximum_distance() / 10.0) * distance_tier;
    if max_dist < slot_data.minimum_distance() {
        slot_data.minimum_distance() * (1.0 + DISTANCE_LENIENCY_M)
    } else {
        max_dist
    }
}

fn build_segments_tree(
    elements: &[osm_types::Element],
    ref_ecef: &Coord3d,
    ecef_mat: &AffineTransform3d,
) -> SegmentsTree {
    console_log!("{} elements", elements.len());
    let coords: HashMap<i64, Coord> = elements
        .iter()
        .filter_map(|el| {
            if let osm_types::Element::Node(node) = el {
                let point_geo = Coord {
                    x: node.lon,
                    y: node.lat,
                };
                let point_enu = geo_to_enu(&point_geo, ref_ecef, ecef_mat);
                Some((node.id.0, (point_enu.x, point_enu.y).into()))
            } else {
                None
            }
        })
        .collect();
    console_log!("{} nodes", coords.len());
    let ways: Vec<Vec<i64>> = elements
        .iter()
        .filter_map(|el| {
            if let osm_types::Element::Way(way) = el {
                Some(way.nodes.iter().map(|r| r.0).collect())
            } else {
                None
            }
        })
        .collect();
    console_log!("{} ways", ways.len());

    let mut node_use_count: HashMap<i64, u32> = HashMap::new();
    for way in &ways {
        for node_id in way {
            node_use_count.insert(*node_id, node_use_count.get(node_id).unwrap_or(&0u32) + 1);
        }
    }

    let junction_nodes: HashSet<i64> = node_use_count
        .iter()
        .filter_map(
            |(node_id, count)| {
                if *count > 1u32 { Some(*node_id) } else { None }
            },
        )
        .collect();
    drop(node_use_count);
    console_log!("{} junction nodes", junction_nodes.len());

    let mut way_linestrings = Vec::<GeomWithData<LineString, (i64, i64)>>::new();
    for way in ways {
        let mut segment_coords: Vec<Coord> = Vec::new();
        let mut first_node = way.first().unwrap();
        for node_id in &way {
            if let Some(coord) = coords.get(node_id) {
                segment_coords.push(*coord);
                if junction_nodes.contains(node_id) {
                    if segment_coords.len() >= 2 {
                        way_linestrings.push(GeomWithData::new(
                            LineString::from(segment_coords),
                            (*first_node, *node_id),
                        ));
                    }
                    segment_coords = vec![*coord];
                    first_node = node_id;
                }
            }
        }
        if segment_coords.len() >= 2 {
            way_linestrings.push(GeomWithData::new(
                LineString::from(segment_coords),
                (*first_node, *(way.last().unwrap())),
            ));
        }
    }
    console_log!("{} linestrings", way_linestrings.len());
    let segments_tree = RTree::bulk_load(way_linestrings);
    console_log!("{} segments in tree", segments_tree.size());
    segments_tree
}

fn trim_tree_to_graph<T>(
    segments_tree: &SegmentsTree,
    node_ids: T,
    mode: SubgraphSelection,
    maximum_distance: f64,
) -> Result<Option<HashSet<i64>>, &'static str>
where
    T: Iterator<Item = i64>,
{
    let mut graph = petgraph::graph::Graph::<i64, f64, petgraph::Undirected>::new_undirected();
    let osm_id_to_graph_id: HashMap<i64, petgraph::graph::NodeIndex> = node_ids
        .map(|node_int| (node_int, graph.add_node(node_int)))
        .collect();
    console_log!("{} nodes", graph.node_count());

    for segment in segments_tree {
        graph.add_edge(
            *osm_id_to_graph_id.get(&segment.data.0).unwrap(),
            *osm_id_to_graph_id.get(&segment.data.1).unwrap(),
            ::geo::algorithm::line_measures::Euclidean.length(segment.geom()),
        );
    }
    console_log!("{} edges", graph.edge_count());

    let maybe_nodes_to_keep: Option<HashSet<petgraph::graph::NodeIndex>> = match mode {
        SubgraphSelection::BiggestSubgraph => {
            let sccs = petgraph::algo::kosaraju_scc(&graph);
            let max_scc = sccs
                .into_iter()
                .max_by(|c1, c2| c1.len().cmp(&c2.len()))
                .unwrap();
            console_log!("Largest connected component has {} nodes", max_scc.len(),);

            Some(max_scc.into_iter().collect())
        }
        SubgraphSelection::ClosestSubgraph => {
            let home_enu = Point::new(0.0, 0.0);
            let starting_line = segments_tree.nearest_neighbor(&home_enu).unwrap();
            console_log!("starting_line: {:?}", starting_line);
            let starting_point = match starting_line.geom().closest_point(&home_enu) {
                ::geo::Closest::Intersection(point) => point,
                ::geo::Closest::SinglePoint(point) => point,
                ::geo::Closest::Indeterminate => return Err("Indeterminate starting point"),
            };
            console_log!("starting_point: {:?}", starting_point);
            let distance_to_starting_point = starting_point.distance_2(&home_enu).sqrt();
            console_log!(
                "distance_to_starting_point: {:?}",
                distance_to_starting_point
            );
            let fraction_along_line = starting_line
                .geom()
                .line_locate_point(&starting_point)
                .unwrap();
            console_log!("fraction_along_line: {:?}", fraction_along_line);
            let (starting_node, distance_to_starting_node) = if fraction_along_line < 0.5 {
                (
                    osm_id_to_graph_id.get(&starting_line.data.0).unwrap(),
                    distance_to_starting_point
                        + fraction_along_line
                            * ::geo::algorithm::line_measures::Euclidean
                                .length(starting_line.geom()),
                )
            } else {
                (
                    osm_id_to_graph_id.get(&starting_line.data.1).unwrap(),
                    distance_to_starting_point
                        + (1.0 - fraction_along_line)
                            * ::geo::algorithm::line_measures::Euclidean
                                .length(starting_line.geom()),
                )
            };
            console_log!("starting_node: {:?}", starting_node);
            console_log!("distance_to_starting_node: {:?}", distance_to_starting_node);
            let node_distances =
                petgraph::algo::dijkstra::dijkstra(&graph, *starting_node, None, |edge| {
                    *edge.weight()
                });
            let nodes_within_distance: HashSet<petgraph::graph::NodeIndex> = node_distances
                .iter()
                .filter_map(|(node_id, distance)| {
                    if *distance <= maximum_distance - distance_to_starting_node {
                        Some(*node_id)
                    } else {
                        None
                    }
                })
                .collect();
            drop(node_distances);
            console_log!("{} nodes within range", nodes_within_distance.len());
            let neighbors = nodes_within_distance
                .iter()
                .flat_map(|node_index| graph.neighbors(*node_index));
            Some(std::iter::chain(nodes_within_distance.iter().copied(), neighbors).collect())
        }
        SubgraphSelection::FullGraph => None,
    };

    if let Some(nodes_to_keep) = maybe_nodes_to_keep {
        Ok(Some(
            osm_id_to_graph_id
                .iter()
                .filter_map(|(k, v)| {
                    if nodes_to_keep.contains(v) {
                        Some(*k)
                    } else {
                        None
                    }
                })
                .collect(),
        ))
    } else {
        Ok(None)
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
    let (ref_ecef, ecef_mat) = geo_ref_ecef_mat(&home);
    let geo_mat = ecef_mat.transposed();

    let mut min_dist = params.slot_data().minimum_distance();
    if min_dist > params.slot_data().maximum_distance() {
        min_dist = params.slot_data().maximum_distance() * (1.0 - DISTANCE_LENIENCY_M);
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
        console_log!("Area {area}: {count} trips at most tier {distance}");
    }

    /*
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
    */

    // (first node ID, last node ID)
    let mut segments_tree = build_segments_tree(
        &params
            .osm()
            .elements()
            .iter()
            .filter_map(|el| {
                if el.r#type() == "node" {
                    let node = el.unchecked_ref::<JsOsmNode>();
                    Some(osm_types::Element::Node(osm_types::Node {
                        id: osm_types::Id(node.id() as i64),
                        tags: node
                            .tags()
                            .map(|a| js_sys::Reflect::own_keys(&a))
                            .and_then(|b| js_sys::try_iter(&b.unwrap()).unwrap())
                            .map(|c| {
                                c.map(|key| {
                                    let key2 = key.unwrap();
                                    (
                                        key2.as_string().unwrap(),
                                        js_sys::Reflect::get(&node.tags().unwrap(), &key2)
                                            .unwrap()
                                            .as_string()
                                            .unwrap(),
                                    )
                                })
                                .collect()
                            }),
                        info: None,
                        lat: node.lat(),
                        lon: node.lon(),
                    }))
                } else if el.r#type() == "way" {
                    let way = el.unchecked_ref::<JsOsmWay>();
                    Some(osm_types::Element::Way(osm_types::Way {
                        id: osm_types::Id(way.id() as i64),
                        tags: way
                            .tags()
                            .map(|a| js_sys::Reflect::own_keys(&a))
                            .and_then(|b| js_sys::try_iter(&b.unwrap()).unwrap())
                            .map(|c| {
                                c.map(|key| {
                                    let key2 = key.unwrap();
                                    (
                                        key2.as_string().unwrap(),
                                        js_sys::Reflect::get(&way.tags().unwrap(), &key2)
                                            .unwrap()
                                            .as_string()
                                            .unwrap(),
                                    )
                                })
                                .collect()
                            }),
                        info: None,
                        nodes: way
                            .nodes()
                            .iter()
                            .map(|node_id_float| osm_types::Id(*node_id_float as i64))
                            .collect(),
                    }))
                } else {
                    None
                }
            })
            .collect::<Vec<osm_types::Element>>(),
        &ref_ecef,
        &ecef_mat,
    );
    if segments_tree.size() == 0 {
        return Err("No segments");
    }

    if (params.subgraph_selection() == SubgraphSelection::BiggestSubgraph
        || params.subgraph_selection() == SubgraphSelection::ClosestSubgraph)
        && let Some(new_nodes) = trim_tree_to_graph(
            &segments_tree,
            params.osm().elements().iter().filter_map(|el| {
                if el.r#type() == "node" {
                    let node = el.unchecked_ref::<JsOsmNode>();
                    Some(node.id() as i64)
                } else {
                    None
                }
            }),
            params.subgraph_selection(),
            params.slot_data().maximum_distance(),
        )?
    {
        segments_tree = RTree::bulk_load(
            segments_tree
                .into_iter()
                .filter(|segment| {
                    new_nodes.contains(&segment.data.0) || new_nodes.contains(&segment.data.1)
                })
                .collect(),
        );
        console_log!("Now {} segments in tree", segments_tree.size());
    }

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
            console_log!(
                    "Attempt {attempt}: Generating random point with radius between {min_dist} and {max_dist}"
                );

            let random_point = random_point_in_circle(min_dist, max_dist, &mut rng);
            console_log!("Random point is {random_point:?}");

            // Don't generate points too close to each other, but at a lower priority than
            // checking for nearby segments
            if attempt < MAX_ATTEMPTS / 2
                && let Some(nearest_other_point) = points_tree.nearest_neighbor(&random_point)
                && random_point.distance_2(nearest_other_point.geom())
                    < GENERATED_DISTANCE_THRESHOLD_M_2
            {
                continue;
            }

            let Some(nearest_segment) = segments_tree.nearest_neighbor(&random_point) else {
                // empty tree?
                return;
            };
            let nearest_point_on_segment = match nearest_segment.geom().closest_point(&random_point) {
                ::geo::Closest::Indeterminate => continue,
                ::geo::Closest::Intersection(point) => point,
                ::geo::Closest::SinglePoint(point) => point,
            };
            let distance_to_nearest_point_m_2 =
                random_point.distance_2(&nearest_point_on_segment);
            if distance_to_nearest_point_m_2 < GENERATED_DISTANCE_THRESHOLD_M_2
                || attempt >= MAX_ATTEMPTS
            {
                let selected_point = if attempt < MAX_ATTEMPTS {
                    random_point
                } else {
                    console_log!("Out of attempts, snapping to {nearest_point_on_segment:?}");
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
                let geo_coord = enu_to_geo(&enu_coord, &ref_ecef, &geo_mat);
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
    let (ref_ecef, ecef_mat) = geo_ref_ecef_mat(&home);

    let points_tree = RTree::<GeomWithData<Point, i64>>::bulk_load(
        points
            .keys()
            .into_iter()
            .flatten()
            .map(|location_id| {
                let v = points.get(&location_id);
                let enu_coord = geo_to_enu(
                    &(v.get(0).as_f64().unwrap(), v.get(1).as_f64().unwrap()).into(),
                    &ref_ecef,
                    &ecef_mat,
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
        &coord_geo,
        &internal.ref_ecef.ok_or(())?,
        &internal.ecef_mat.ok_or(())?,
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

#[cfg(test)]
mod tests {
    use crate::*;
    use ::geo::{Buffer, MapCoords};
    use geojson::{Feature, FeatureCollection, GeoJson, Geometry};

    fn segments_to_geojson(
        ref_ecef: &Coord3d,
        geo_mat: &AffineTransform3d,
        segments_tree: &SegmentsTree,
    ) -> GeoJson {
        let boppables: Vec<::geo::MultiPolygon> = segments_tree
            .iter()
            .map(|segment| segment.geom().buffer(COLLECTION_DISTANCE_BASE_M))
            .collect();
        GeoJson::Feature(Feature::from(Geometry::from(
            &::geo::algorithm::unary_union(boppables.iter().by_ref()).map_coords(|coord| {
                let enu_coord = Coord3d {
                    x: coord.x,
                    y: coord.y,
                    z: 0.0,
                };
                enu_to_geo(&enu_coord, ref_ecef, geo_mat)
            }),
        )))
    }

    #[derive(serde::Deserialize)]
    struct OsmDoc {
        elements: Vec<osm_types::Element>,
    }

    #[test]
    pub fn test_graphs() {
        let home = Coord {
            x: -116.88429227615799,
            y: 32.55584395634817,
        };
        let doc: OsmDoc =
            serde_json::from_str(&std::fs::read_to_string("testdata.json").unwrap()).unwrap();

        let (ref_ecef, ecef_mat) = geo_ref_ecef_mat(&home);
        let geo_mat = ecef_mat.transposed();

        {
            let segments_tree = build_segments_tree(&doc.elements, &ref_ecef, &ecef_mat);
            let geojson = GeoJson::FeatureCollection(FeatureCollection::from_iter(
                segments_tree.iter().map(|seg| {
                    Feature::from(Geometry::from(&seg.geom().map_coords(|coord| {
                        let enu_coord = Coord3d {
                            x: coord.x,
                            y: coord.y,
                            z: 0.0,
                        };
                        enu_to_geo(&enu_coord, &ref_ecef, &geo_mat)
                    })))
                }),
            ));
            let geojson_string = geojson.to_string();
            std::fs::write("segments.geojson", geojson_string).unwrap();
        }

        for (filter_type, filter_name) in [
            (SubgraphSelection::FullGraph, "FullGraph"),
            (SubgraphSelection::BiggestSubgraph, "BiggestSubgraph"),
            (SubgraphSelection::ClosestSubgraph, "ClosestSubgraph"),
        ] {
            println!("{}", filter_name);

            // I'd like to build the tree outside of the loop but I can't figure out the borrow
            // mechanics right now
            let segments_tree = build_segments_tree(&doc.elements, &ref_ecef, &ecef_mat);

            let trimmed_tree = if let Some(new_nodes) = trim_tree_to_graph(
                &segments_tree,
                doc.elements.iter().filter_map(|e| {
                    if let osm_types::Element::Node(n) = e {
                        Some(n.id.0)
                    } else {
                        None
                    }
                }),
                filter_type,
                5000.0,
            )
            .unwrap()
            {
                RTree::bulk_load(
                    segments_tree
                        .into_iter()
                        .filter(|segment| {
                            new_nodes.contains(&segment.data.0)
                                || new_nodes.contains(&segment.data.1)
                        })
                        .collect(),
                )
            } else {
                segments_tree.clone()
            };
            let geojson_string =
                segments_to_geojson(&ref_ecef, &geo_mat, &trimmed_tree).to_string();
            std::fs::write(format!("{}.geojson", filter_name), geojson_string).unwrap();
        }
    }
}
