// From https://github.com/sameer/osm-types
// Copyright 2023 Sameer Puri

// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at

//     http://www.apache.org/licenses/LICENSE-2.0

// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use std::collections::HashMap;

/// Fundamental representation of geographical features in OpenStreetMap
///
/// <https://wiki.openstreetmap.org/wiki/Elements>
#[derive(Debug, PartialEq, Clone)]
#[cfg_attr(test, derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(test, serde(tag = "type"))]
pub enum Element {
    #[cfg_attr(test, serde(rename = "node"))]
    Node(Node),
    #[cfg_attr(test, serde(rename = "way"))]
    Way(Way),
    #[cfg_attr(test, serde(rename = "relation"))]
    Relation(Relation),
}

impl Element {
    pub fn id(&self) -> Id {
        match self {
            Element::Node(Node { id, .. })
            | Element::Way(Way { id, .. })
            | Element::Relation(Relation { id, .. }) => *id,
        }
    }

    pub fn tags(&self) -> &Option<HashMap<String, String>> {
        match self {
            Element::Node(Node { tags, .. })
            | Element::Way(Way { tags, .. })
            | Element::Relation(Relation { tags, .. }) => tags,
        }
    }

    pub fn info(&self) -> Option<&Info> {
        match self {
            Element::Node(Node { info, .. })
            | Element::Way(Way { info, .. })
            | Element::Relation(Relation { info, .. }) => info.as_ref(),
        }
    }

    /// Removes [Info] if present
    pub fn strip_info(&mut self) {
        let info = match self {
            Element::Node(Node { info, .. })
            | Element::Way(Way { info, .. })
            | Element::Relation(Relation { info, .. }) => info,
        };
        *info = None;
    }

    pub fn as_node(&self) -> Option<&Node> {
        if let Element::Node(n) = self {
            Some(n)
        } else {
            None
        }
    }

    pub fn as_way(&self) -> Option<&Way> {
        if let Element::Way(w) = self {
            Some(w)
        } else {
            None
        }
    }

    pub fn as_relation(&self) -> Option<&Relation> {
        if let Element::Relation(r) = self {
            Some(r)
        } else {
            None
        }
    }
}

/// [Element] identifier
#[derive(Debug, PartialEq, Eq, PartialOrd, Ord, Clone, Copy, Hash)]
#[cfg_attr(test, derive(serde::Serialize, serde::Deserialize))]
pub struct Id(pub i64);

/// Single point in space
///
/// <https://wiki.openstreetmap.org/wiki/Node>
#[derive(Debug, PartialEq, Clone)]
#[cfg_attr(test, derive(serde::Serialize, serde::Deserialize))]
pub struct Node {
    pub id: Id,
    pub tags: Option<HashMap<String, String>>,
    pub info: Option<Info>,
    /// [WGS 84](https://en.wikipedia.org/wiki/World_Geodetic_System#WGS84) latitude (y)
    pub lat: f64,
    /// [WGS 84](https://en.wikipedia.org/wiki/World_Geodetic_System#WGS84) longitude (x)
    pub lon: f64,
}

impl Node {
    /// Removes [Info] if present
    pub fn strip_info(&mut self) {
        self.info = None;
    }
}

/// Ordered list of [Node]s
///
/// <https://wiki.openstreetmap.org/wiki/Way>
#[derive(Debug, PartialEq, Eq, Clone)]
#[cfg_attr(test, derive(serde::Serialize, serde::Deserialize))]
pub struct Way {
    pub id: Id,
    pub tags: Option<HashMap<String, String>>,
    pub info: Option<Info>,

    /// Nodes in the way
    ///
    /// In an [open way](https://wiki.openstreetmap.org/wiki/Way#Open_way_%28open_polyline%29), the first and last nodes differ.
    /// In a [closed way](https://wiki.openstreetmap.org/wiki/Way#Closed_way_%28closed_polyline%29), the first and last nodes are identical.
    pub nodes: Vec<Id>,
}

impl Way {
    /// Removes [Info] if present
    pub fn strip_info(&mut self) {
        self.info = None;
    }
}

/// Ordered list of [Element]s
///
/// This is a logical representation
/// <https://wiki.openstreetmap.org/wiki/Relation>
#[derive(Debug, PartialEq, Eq, Clone)]
#[cfg_attr(test, derive(serde::Serialize, serde::Deserialize))]
pub struct Relation {
    pub id: Id,
    pub tags: Option<HashMap<String, String>>,
    pub info: Option<Info>,
    /// There should be no more than 300 members per relation, with a hard limit of 32,000
    ///
    /// <https://wiki.openstreetmap.org/wiki/Relation#Size>
    pub members: Vec<Member>,
}

impl Relation {
    /// Removes [Info] if present
    pub fn strip_info(&mut self) {
        self.info = None;
    }
}

/// [Element] in a [Relation]
#[derive(Debug, PartialEq, Eq, Clone, Hash)]
#[cfg_attr(test, derive(serde::Serialize, serde::Deserialize))]
pub struct Member {
    pub id: Id,
    pub ty: MemberType,
    /// Describes the function of this member in its relation
    ///
    /// <https://wiki.openstreetmap.org/wiki/Relation#Roles>
    pub role: Option<String>,
}

/// Type of [Element] represented by [Member]
#[derive(Debug, PartialEq, Eq, Clone, Hash)]
#[cfg_attr(test, derive(serde::Serialize, serde::Deserialize))]
pub enum MemberType {
    Node,
    Way,
    Relation,
}

/// Non-geographical information about a [Element]
///
/// <https://wiki.openstreetmap.org/wiki/Elements#Common_attributes>
#[derive(Debug, PartialEq, Eq, Clone, Hash)]
#[cfg_attr(test, derive(serde::Serialize, serde::Deserialize))]
pub struct Info {
    /// Version number of this revision of the [Element]
    ///
    /// Starts at 1 and incremented with each update
    pub version: i32,
    /// Time of last modification
    //pub timestamp: Option<NaiveDateTime>,
    /// Group of edits that this version belongs to
    ///
    /// <https://wiki.openstreetmap.org/wiki/Changeset>
    pub changeset: Option<i64>,
    /// ID of user who performed the last modification
    pub uid: Option<i32>,
    /// Display name of the user
    ///
    /// This will change without a version increment if the user modifies their display name.
    pub user: Option<String>,
    /// Whether a [Element] is visible or not
    ///
    /// Assume this to be true if it is [None]. If [Some(false)], the [Element] was deleted
    /// and was returned by a history call.
    pub visible: Option<bool>,
}
