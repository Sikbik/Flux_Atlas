//! Sectioned little-endian container shared by `nodes.bin` and `mesh.bin`.
//!
//! Layout (see `README.md` next to this file for the byte-exact description):
//! a 32-byte header, a section table of 12-byte entries padded to 8 bytes, then sections, each
//! starting at an 8-byte aligned absolute offset and zero-padded to a multiple of 8.

use std::collections::HashMap;

/// Header size in bytes.
pub const HEADER_LEN: usize = 32;
/// Section table entry size in bytes.
pub const SECTION_ENTRY_LEN: usize = 12;

/// Element type of a section.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[repr(u16)]
pub enum DType {
    U8 = 1,
    U16 = 2,
    U32 = 3,
    I32 = 4,
    F32 = 5,
    F64 = 6,
    U64 = 7,
    /// `u32 n`, `u32 offsets[n + 1]` (relative to the blob), UTF-8 blob.
    StringTable = 16,
    /// Section-specific structured layout.
    Struct = 17,
}

impl DType {
    pub fn from_u16(v: u16) -> Option<Self> {
        Some(match v {
            1 => Self::U8,
            2 => Self::U16,
            3 => Self::U32,
            4 => Self::I32,
            5 => Self::F32,
            6 => Self::F64,
            7 => Self::U64,
            16 => Self::StringTable,
            17 => Self::Struct,
            _ => return None,
        })
    }

    /// Element size for fixed-width types.
    pub const fn elem_size(self) -> Option<usize> {
        match self {
            Self::U8 => Some(1),
            Self::U16 => Some(2),
            Self::U32 | Self::I32 | Self::F32 => Some(4),
            Self::F64 | Self::U64 => Some(8),
            Self::StringTable | Self::Struct => None,
        }
    }
}

/// Container decoding errors.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum CodecError {
    #[error("buffer too short")]
    Truncated,
    #[error("bad magic")]
    BadMagic,
    #[error("unsupported version {0}")]
    UnsupportedVersion(u16),
    #[error("section {kind} out of bounds")]
    SectionBounds { kind: u16 },
    #[error("section {kind} is not 8-byte aligned")]
    Misaligned { kind: u16 },
    #[error("section {kind} has dtype {found}, expected {expected}")]
    WrongDType {
        kind: u16,
        found: u16,
        expected: u16,
    },
    #[error("section {kind} has {found} elements, expected {expected}")]
    WrongLength {
        kind: u16,
        found: usize,
        expected: usize,
    },
    #[error("section {kind}: invalid string table")]
    BadStringTable { kind: u16 },
    #[error("section {kind}: invalid structure")]
    BadStruct { kind: u16 },
    #[error("missing required section {0}")]
    MissingSection(u16),
}

/// Section kind of the ORIGIN struct, shared by every container format (`nodes.bin`,
/// `mesh.bin`): the server instance and start epoch the snapshot was built by. Node ids and seqs
/// are local to one instance and one process, so a client must never combine snapshots or live
/// messages of different origins.
pub const ORIGIN_KIND: u16 = 48;
/// Byte length of the ORIGIN struct.
pub const ORIGIN_LEN: usize = 16;

/// Which server built a snapshot (section [`ORIGIN_KIND`], dtype struct, 16 bytes):
/// `u64 started_ms` (the server process start epoch, `ServerInfo.started_ms`), then
/// `u64 instance` (the data directory's random instance id; `ServerInfo.instance` is its
/// 16-digit lowercase hex form).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Origin {
    pub started_ms: u64,
    pub instance: u64,
}

impl Origin {
    /// The hex form used in JSON (`ServerInfo.instance`).
    pub fn instance_hex(&self) -> String {
        format!("{:016x}", self.instance)
    }

    /// Parses the hex form of an instance id.
    pub fn parse_instance(hex: &str) -> Option<u64> {
        if hex.len() == 16 {
            u64::from_str_radix(hex, 16).ok()
        } else {
            None
        }
    }

    pub fn encode(&self) -> Vec<u8> {
        let mut v = Vec::with_capacity(ORIGIN_LEN);
        v.extend_from_slice(&self.started_ms.to_le_bytes());
        v.extend_from_slice(&self.instance.to_le_bytes());
        v
    }

    pub fn decode(bytes: &[u8]) -> Result<Self, CodecError> {
        let err = CodecError::BadStruct { kind: ORIGIN_KIND };
        Ok(Self {
            started_ms: read_u64(bytes, 0).ok_or(err.clone())?,
            instance: read_u64(bytes, 8).ok_or(err)?,
        })
    }
}

/// Header fields.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Header {
    pub magic: [u8; 4],
    pub version: u16,
    pub flags: u16,
    pub seq: u64,
    pub generated_ms: u64,
    pub count: u32,
}

/// Builds a container from sections.
pub struct ContainerWriter {
    header: Header,
    sections: Vec<(u16, DType, Vec<u8>)>,
}

impl ContainerWriter {
    pub fn new(header: Header) -> Self {
        Self {
            header,
            sections: Vec::new(),
        }
    }

    /// Adds a section with raw little-endian bytes.
    pub fn section(&mut self, kind: u16, dtype: DType, bytes: Vec<u8>) -> &mut Self {
        self.sections.push((kind, dtype, bytes));
        self
    }

    /// Removes the sections of the given kinds (a producer that did not record a column leaves
    /// it out rather than writing placeholder zeros).
    pub fn drop_sections(&mut self, kinds: &[u16]) -> &mut Self {
        self.sections.retain(|(k, _, _)| !kinds.contains(k));
        self
    }

    pub fn u8s(&mut self, kind: u16, v: &[u8]) -> &mut Self {
        self.section(kind, DType::U8, v.to_vec())
    }

    pub fn u16s(&mut self, kind: u16, v: &[u16]) -> &mut Self {
        self.section(
            kind,
            DType::U16,
            v.iter().flat_map(|x| x.to_le_bytes()).collect(),
        )
    }

    pub fn u32s(&mut self, kind: u16, v: &[u32]) -> &mut Self {
        self.section(
            kind,
            DType::U32,
            v.iter().flat_map(|x| x.to_le_bytes()).collect(),
        )
    }

    pub fn f32s(&mut self, kind: u16, v: &[f32]) -> &mut Self {
        self.section(
            kind,
            DType::F32,
            v.iter().flat_map(|x| x.to_le_bytes()).collect(),
        )
    }

    pub fn strings<S: AsRef<str>>(&mut self, kind: u16, v: &[S]) -> &mut Self {
        let bytes = encode_string_table(v);
        self.section(kind, DType::StringTable, bytes)
    }

    /// Adds the ORIGIN section when given.
    pub fn origin(&mut self, origin: Option<Origin>) -> &mut Self {
        if let Some(o) = origin {
            self.section(ORIGIN_KIND, DType::Struct, o.encode());
        }
        self
    }

    /// Serializes the container.
    pub fn finish(&self) -> Vec<u8> {
        let table_len = align8(self.sections.len() * SECTION_ENTRY_LEN);
        let mut offset = HEADER_LEN + table_len;
        let mut entries = Vec::with_capacity(self.sections.len());
        for (kind, dtype, bytes) in &self.sections {
            entries.push((*kind, *dtype, offset, bytes.len()));
            offset += align8(bytes.len());
        }
        let mut out = Vec::with_capacity(offset);
        out.extend_from_slice(&self.header.magic);
        out.extend_from_slice(&self.header.version.to_le_bytes());
        out.extend_from_slice(&self.header.flags.to_le_bytes());
        out.extend_from_slice(&self.header.seq.to_le_bytes());
        out.extend_from_slice(&self.header.generated_ms.to_le_bytes());
        out.extend_from_slice(&self.header.count.to_le_bytes());
        out.extend_from_slice(&(self.sections.len() as u32).to_le_bytes());
        for (kind, dtype, off, len) in &entries {
            out.extend_from_slice(&kind.to_le_bytes());
            out.extend_from_slice(&(*dtype as u16).to_le_bytes());
            out.extend_from_slice(&(*off as u32).to_le_bytes());
            out.extend_from_slice(&(*len as u32).to_le_bytes());
        }
        pad8(&mut out);
        for (_, _, bytes) in &self.sections {
            out.extend_from_slice(bytes);
            pad8(&mut out);
        }
        debug_assert_eq!(out.len(), offset);
        out
    }
}

/// Encodes a string table: `u32 n`, `u32 offsets[n + 1]`, blob.
pub fn encode_string_table<S: AsRef<str>>(v: &[S]) -> Vec<u8> {
    let blob_len: usize = v.iter().map(|s| s.as_ref().len()).sum();
    let mut out = Vec::with_capacity(4 + 4 * (v.len() + 1) + blob_len);
    out.extend_from_slice(&(v.len() as u32).to_le_bytes());
    let mut off = 0u32;
    out.extend_from_slice(&off.to_le_bytes());
    for s in v {
        off += s.as_ref().len() as u32;
        out.extend_from_slice(&off.to_le_bytes());
    }
    for s in v {
        out.extend_from_slice(s.as_ref().as_bytes());
    }
    out
}

/// Decodes a string table, returning the strings and the number of bytes consumed.
pub fn decode_string_table(bytes: &[u8], kind: u16) -> Result<(Vec<String>, usize), CodecError> {
    let err = || CodecError::BadStringTable { kind };
    let n = read_u32(bytes, 0).ok_or_else(err)? as usize;
    let offsets_end = 4usize
        .checked_add(
            n.checked_add(1)
                .ok_or_else(err)?
                .checked_mul(4)
                .ok_or_else(err)?,
        )
        .ok_or_else(err)?;
    if offsets_end > bytes.len() {
        return Err(err());
    }
    let mut offsets = Vec::with_capacity(n + 1);
    for i in 0..=n {
        offsets.push(read_u32(bytes, 4 + 4 * i).ok_or_else(err)? as usize);
    }
    let blob_len = *offsets.last().ok_or_else(err)?;
    let blob = bytes
        .get(offsets_end..offsets_end + blob_len)
        .ok_or_else(err)?;
    let mut out = Vec::with_capacity(n);
    for w in offsets.windows(2) {
        if w[0] > w[1] {
            return Err(err());
        }
        let s = std::str::from_utf8(&blob[w[0]..w[1]]).map_err(|_| err())?;
        out.push(s.to_owned());
    }
    Ok((out, offsets_end + blob_len))
}

/// A parsed container borrowing the input buffer.
#[derive(Debug)]
pub struct ContainerReader<'a> {
    pub header: Header,
    sections: HashMap<u16, (DType, &'a [u8])>,
    /// Section kinds present in the table in file order (including unknown dtypes).
    pub kinds: Vec<u16>,
}

impl<'a> ContainerReader<'a> {
    /// Parses and validates header and section table. Sections with unknown dtypes are
    /// recorded in `kinds` but not exposed.
    pub fn parse(buf: &'a [u8], magic: [u8; 4], max_version: u16) -> Result<Self, CodecError> {
        if buf.len() < HEADER_LEN {
            return Err(CodecError::Truncated);
        }
        if buf[0..4] != magic {
            return Err(CodecError::BadMagic);
        }
        let version = read_u16(buf, 4).ok_or(CodecError::Truncated)?;
        if version == 0 || version > max_version {
            return Err(CodecError::UnsupportedVersion(version));
        }
        let header = Header {
            magic,
            version,
            flags: read_u16(buf, 6).ok_or(CodecError::Truncated)?,
            seq: read_u64(buf, 8).ok_or(CodecError::Truncated)?,
            generated_ms: read_u64(buf, 16).ok_or(CodecError::Truncated)?,
            count: read_u32(buf, 24).ok_or(CodecError::Truncated)?,
        };
        let section_count = read_u32(buf, 28).ok_or(CodecError::Truncated)? as usize;
        let table_end = HEADER_LEN
            .checked_add(
                section_count
                    .checked_mul(SECTION_ENTRY_LEN)
                    .ok_or(CodecError::Truncated)?,
            )
            .ok_or(CodecError::Truncated)?;
        if table_end > buf.len() {
            return Err(CodecError::Truncated);
        }
        let mut sections = HashMap::new();
        let mut kinds = Vec::with_capacity(section_count);
        for i in 0..section_count {
            let base = HEADER_LEN + i * SECTION_ENTRY_LEN;
            let kind = read_u16(buf, base).ok_or(CodecError::Truncated)?;
            let dtype_raw = read_u16(buf, base + 2).ok_or(CodecError::Truncated)?;
            let offset = read_u32(buf, base + 4).ok_or(CodecError::Truncated)? as usize;
            let len = read_u32(buf, base + 8).ok_or(CodecError::Truncated)? as usize;
            if !offset.is_multiple_of(8) {
                return Err(CodecError::Misaligned { kind });
            }
            let end = offset
                .checked_add(len)
                .ok_or(CodecError::SectionBounds { kind })?;
            if offset < table_end || end > buf.len() {
                return Err(CodecError::SectionBounds { kind });
            }
            kinds.push(kind);
            if let Some(dtype) = DType::from_u16(dtype_raw) {
                sections.insert(kind, (dtype, &buf[offset..end]));
            }
        }
        Ok(Self {
            header,
            sections,
            kinds,
        })
    }

    pub fn has(&self, kind: u16) -> bool {
        self.sections.contains_key(&kind)
    }

    /// The ORIGIN section, when present.
    pub fn origin(&self) -> Result<Option<Origin>, CodecError> {
        self.raw(ORIGIN_KIND, DType::Struct)?
            .map(Origin::decode)
            .transpose()
    }

    /// Raw section bytes, checking the dtype.
    pub fn raw(&self, kind: u16, expected: DType) -> Result<Option<&'a [u8]>, CodecError> {
        match self.sections.get(&kind) {
            None => Ok(None),
            Some((d, bytes)) if *d == expected => Ok(Some(bytes)),
            Some((d, _)) => Err(CodecError::WrongDType {
                kind,
                found: *d as u16,
                expected: expected as u16,
            }),
        }
    }

    fn column(
        &self,
        kind: u16,
        dtype: DType,
        count: usize,
    ) -> Result<Option<&'a [u8]>, CodecError> {
        let Some(bytes) = self.raw(kind, dtype)? else {
            return Ok(None);
        };
        let size = dtype.elem_size().unwrap_or(1);
        if bytes.len() != count * size {
            return Err(CodecError::WrongLength {
                kind,
                found: bytes.len() / size,
                expected: count,
            });
        }
        Ok(Some(bytes))
    }

    pub fn u8s(&self, kind: u16, count: usize) -> Result<Option<Vec<u8>>, CodecError> {
        Ok(self.column(kind, DType::U8, count)?.map(<[u8]>::to_vec))
    }

    pub fn u16s(&self, kind: u16, count: usize) -> Result<Option<Vec<u16>>, CodecError> {
        Ok(self.column(kind, DType::U16, count)?.map(|b| {
            b.chunks_exact(2)
                .map(|c| u16::from_le_bytes([c[0], c[1]]))
                .collect()
        }))
    }

    pub fn u32s(&self, kind: u16, count: usize) -> Result<Option<Vec<u32>>, CodecError> {
        Ok(self.column(kind, DType::U32, count)?.map(|b| {
            b.chunks_exact(4)
                .map(|c| u32::from_le_bytes([c[0], c[1], c[2], c[3]]))
                .collect()
        }))
    }

    pub fn f32s(&self, kind: u16, count: usize) -> Result<Option<Vec<f32>>, CodecError> {
        Ok(self.column(kind, DType::F32, count)?.map(|b| {
            b.chunks_exact(4)
                .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
                .collect()
        }))
    }

    pub fn strings(&self, kind: u16) -> Result<Option<Vec<String>>, CodecError> {
        let Some(bytes) = self.raw(kind, DType::StringTable)? else {
            return Ok(None);
        };
        let (v, used) = decode_string_table(bytes, kind)?;
        if used != bytes.len() {
            return Err(CodecError::BadStringTable { kind });
        }
        Ok(Some(v))
    }
}

pub(crate) const fn align8(n: usize) -> usize {
    (n + 7) & !7
}

fn pad8(v: &mut Vec<u8>) {
    let target = align8(v.len());
    v.resize(target, 0);
}

pub(crate) fn read_u16(b: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_le_bytes(b.get(at..at + 2)?.try_into().ok()?))
}

pub(crate) fn read_u32(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(b.get(at..at + 4)?.try_into().ok()?))
}

pub(crate) fn read_u64(b: &[u8], at: usize) -> Option<u64> {
    Some(u64::from_le_bytes(b.get(at..at + 8)?.try_into().ok()?))
}

pub(crate) fn read_f32(b: &[u8], at: usize) -> Option<f32> {
    Some(f32::from_le_bytes(b.get(at..at + 4)?.try_into().ok()?))
}

#[cfg(test)]
mod tests {
    use super::*;

    const MAGIC: [u8; 4] = *b"TEST";

    fn header(count: u32) -> Header {
        Header {
            magic: MAGIC,
            version: 1,
            flags: 0,
            seq: 5,
            generated_ms: 6,
            count,
        }
    }

    #[test]
    fn alignment_and_roundtrip() {
        let mut w = ContainerWriter::new(header(3));
        w.u8s(1, &[1, 2, 3])
            .u16s(2, &[10, 20, 30])
            .strings(3, &["a", "", "xyz"]);
        let buf = w.finish();
        assert_eq!(buf.len() % 8, 0);
        let r = ContainerReader::parse(&buf, MAGIC, 1).unwrap();
        assert_eq!(r.header.seq, 5);
        assert_eq!(r.u8s(1, 3).unwrap().unwrap(), vec![1, 2, 3]);
        assert_eq!(r.u16s(2, 3).unwrap().unwrap(), vec![10, 20, 30]);
        assert_eq!(r.strings(3).unwrap().unwrap(), vec!["a", "", "xyz"]);
        assert!(r.u8s(9, 3).unwrap().is_none());
        assert!(r.u16s(1, 3).is_err());
    }

    #[test]
    fn rejects_garbage() {
        assert_eq!(
            ContainerReader::parse(&[0; 8], MAGIC, 1).unwrap_err(),
            CodecError::Truncated
        );
        let mut buf = ContainerWriter::new(header(0)).finish();
        assert!(ContainerReader::parse(&buf, *b"NOPE", 1).is_err());
        buf[4] = 9;
        assert_eq!(
            ContainerReader::parse(&buf, MAGIC, 1).unwrap_err(),
            CodecError::UnsupportedVersion(9)
        );
    }

    #[test]
    fn unknown_dtype_is_skipped() {
        let mut w = ContainerWriter::new(header(1));
        w.u8s(1, &[7]);
        let mut buf = w.finish();
        // Patch the dtype of the only section to an unknown value.
        buf[HEADER_LEN + 2] = 99;
        let r = ContainerReader::parse(&buf, MAGIC, 1).unwrap();
        assert_eq!(r.kinds, vec![1]);
        assert!(!r.has(1));
    }

    #[test]
    fn string_table_bounds() {
        let mut t = encode_string_table(&["abc"]);
        t[8] = 200; // end offset beyond blob
        assert!(decode_string_table(&t, 1).is_err());
    }
}
