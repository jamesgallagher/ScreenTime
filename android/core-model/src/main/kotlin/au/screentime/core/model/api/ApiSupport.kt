package au.screentime.core.model.api

import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.header
import io.ktor.client.request.parameter
import io.ktor.client.request.request
import io.ktor.client.request.setBody
import io.ktor.client.request.url
import io.ktor.client.statement.HttpResponse
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.http.encodeURLPathPart
import io.ktor.http.isSuccess
import io.ktor.serialization.kotlinx.json.json
import io.ktor.util.reflect.TypeInfo
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.builtins.nullable
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json

// The hand-written half of the API client. ApiModels.kt and ApiClient.kt are generated from contract/openapi.json.

/** How the API reads and writes JSON. A field the server adds later is ignored, so an old app keeps working. */
val ApiJson = Json { ignoreUnknownKeys = true }

/** A value that the API sends as text, like `screens` for [Pool.SCREENS]. */
interface ApiEnum {
    val wire: String
}

/**
 * A field that may be left out or sent as null, and the two mean different things.
 * In [ParentPatch], leaving `phoneE164` out keeps the number, and `Opt.Value(null)` removes it.
 */
@Serializable(with = OptSerializer::class)
sealed interface Opt<out T : Any> {
    /** Left out of the JSON. */
    data object Absent : Opt<Nothing>

    /** Sent, as [value] or as null. */
    data class Value<out T : Any>(val value: T?) : Opt<T>
}

/** The value, or null when it was left out or sent as null. */
val <T : Any> Opt<T>.valueOrNull: T?
    get() = (this as? Opt.Value)?.value

class OptSerializer<T : Any>(private val value: KSerializer<T>) : KSerializer<Opt<T>> {
    private val inner = value.nullable

    override val descriptor: SerialDescriptor = inner.descriptor

    override fun serialize(encoder: Encoder, value: Opt<T>) {
        when (value) {
            // A field that is Opt.Absent is its default, and ApiJson never writes defaults.
            Opt.Absent -> throw SerializationException("Opt.Absent cannot be written")
            is Opt.Value -> inner.serialize(encoder, value.value)
        }
    }

    override fun deserialize(decoder: Decoder): Opt<T> = Opt.Value(inner.deserialize(decoder))
}

/** The server answered with an error. [error] is null when the body was not the API's error JSON. */
class ApiException(val status: Int, val error: ErrorResponseError?) :
    Exception("HTTP $status" + (error?.let { " ${it.code.wire}: ${it.message}" } ?: ""))

/**
 * The answer to a request sent with `If-None-Match`. [value] is null when the server answered 304 Not Modified.
 * [etag] is the version to send next time, and [date] is the server's `Date` header.
 */
data class Conditional<out T>(val value: T?, val etag: String?, val date: String?)

/** What every generated call uses: the HTTP client, the token and the error handling. */
abstract class ApiClientBase(
    private val baseUrl: String,
    engine: HttpClientEngine,
    private val token: suspend () -> String?,
) : AutoCloseable {
    private val http = HttpClient(engine) {
        expectSuccess = false
        install(ContentNegotiation) { json(ApiJson) }
    }

    /** Sends one request. Throws [ApiException] unless the status is 2xx, or 304 for a request sent with [ifNoneMatch]. */
    protected suspend fun call(
        method: HttpMethod,
        path: String,
        auth: Boolean,
        query: List<Pair<String, Any?>> = emptyList(),
        body: Any? = null,
        bodyType: TypeInfo? = null,
        ifNoneMatch: String? = null,
    ): HttpResponse {
        val response = http.request {
            this.method = method
            url(baseUrl.trimEnd('/') + path)
            if (auth) {
                token()?.let { header(HttpHeaders.Authorization, "Bearer $it") }
            }
            for ((name, value) in query) {
                when (value) {
                    null -> {}
                    is ApiEnum -> parameter(name, value.wire)
                    else -> parameter(name, value.toString())
                }
            }
            if (ifNoneMatch != null) {
                header(HttpHeaders.IfNoneMatch, ifNoneMatch)
            }
            if (bodyType != null) {
                contentType(ContentType.Application.Json)
                setBody(body, bodyType)
            }
        }
        val notModified = ifNoneMatch != null && response.status == HttpStatusCode.NotModified
        if (!response.status.isSuccess() && !notModified) {
            val error = try {
                response.body<ErrorResponse>().error
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                null
            }
            throw ApiException(response.status.value, error)
        }
        return response
    }

    /** A path parameter, encoded so that a `/` in it stays inside the segment. */
    protected fun segment(value: String): String = value.encodeURLPathPart()

    override fun close() = http.close()
}
