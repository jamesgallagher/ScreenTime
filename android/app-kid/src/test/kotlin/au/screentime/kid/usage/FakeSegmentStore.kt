package au.screentime.kid.usage

/** [SegmentStore] in memory, for tests. */
class FakeSegmentStore : SegmentStore {
    private class Row(var segment: LocalSegment, var version: Int, var sent: Int)

    private val rows = linkedMapOf<String, Row>()

    fun all(): List<LocalSegment> = rows.values.map { it.segment }

    override suspend fun open() = rows.values.map { it.segment }.filter { it.endedAtMs == null }.maxByOrNull { it.startedAtMs }

    override suspend fun put(segment: LocalSegment) {
        val row = rows[segment.id]
        if (row == null) {
            rows[segment.id] = Row(segment, 1, 0)
        } else {
            row.segment = segment
            row.version++
        }
    }

    override suspend fun touch(id: String, atMs: Long) {
        rows[id]?.let { it.segment = it.segment.copy(lastSeenAtMs = atMs) }
    }

    override suspend fun since(fromMs: Long) = all().filter { it.endedAtMs == null || it.endedAtMs >= fromMs }

    override suspend fun pending(limit: Int) = rows.values
        .filter { it.version > it.sent }
        .sortedBy { it.segment.startedAtMs }
        .take(limit)
        .map { PendingSegment(it.segment, it.version) }

    override suspend fun markSent(id: String, version: Int) {
        rows[id]?.let { if (version > it.sent) it.sent = version }
    }

    override suspend fun prune(beforeMs: Long) {
        rows.values.removeAll { row -> row.version == row.sent && (row.segment.endedAtMs ?: Long.MAX_VALUE) < beforeMs }
    }
}
