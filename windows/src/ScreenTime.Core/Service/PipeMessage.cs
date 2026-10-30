using System.Text.Json;
using System.Text.Json.Serialization;
using ScreenTime.Core.Tray;

namespace ScreenTime.Core.Service;

/// <summary>
/// The JSON lines between the service and the tray (docs/SPEC.md §12.2). The parameters stay in this order: it is the
/// JSON order.
/// </summary>
public sealed record PipeMessage(string Type, string? Id = null, string? Text = null, int? Pid = null,
    string? KidName = null, long? RemainingSec = null, [property: JsonPropertyName("locked")] bool? IsLocked = null, bool? Offline = null, TrayStatus? View = null,
    int? Minutes = null, string? Reason = null, string? PresetId = null, SendResult? Result = null, bool? Approved = null)
{
    /// <summary>Lock the PC now (service to tray).</summary>
    public static PipeMessage Lock(string id) => new("lock", Id: id);

    /// <summary><c>LockWorkStation</c> worked for the <c>lock</c> with this id (tray to service).</summary>
    public static PipeMessage Locked(string id) => new("locked", Id: id);

    /// <summary>Show <c>text</c> (service to tray; CARD-049 shows it, this card only logs it).</summary>
    public static PipeMessage Toast(string text) => new("toast", Text: text);

    /// <summary>Connected; <c>pid</c> is the tray's process id (tray to service).</summary>
    public static PipeMessage Hello(int pid) => new("hello", Pid: pid);

    /// <summary>After every sync of that account (service to tray; the flyout uses it in CARD-049).</summary>
    public static PipeMessage Status(string kidName, long remainingSec, bool locked, bool offline) =>
        new("status", KidName: kidName, RemainingSec: remainingSec, IsLocked: locked, Offline: offline);

    /// <summary>What the tray shows (service to tray, after every sync and on hello).</summary>
    public static PipeMessage ViewOf(TrayStatus status) => new("view", View: status);

    /// <summary>Ask for more time (tray to service).</summary>
    public static PipeMessage Ask(string id, int minutes, string? reason) => new("ask", Id: id, Minutes: minutes, Reason: reason);

    /// <summary>A message to the parents (tray to service).</summary>
    public static PipeMessage Message(string id, string? presetId, string text) => new("message", Id: id, Text: text, PresetId: presetId);

    /// <summary>How the <c>ask</c> or <c>message</c> with this id went (service to tray).</summary>
    public static PipeMessage Reply(string id, SendResult result) => new("reply", Id: id, Result: result);

    /// <summary>A parent's answer, already worded (service to tray).</summary>
    public static PipeMessage Answer(string text, bool approved) => new("answer", Text: text, Approved: approved);

    /// <summary>"I'm the parent": ask every parent to approve parent mode (tray to service).</summary>
    public static PipeMessage ParentAsk(string id) => new("parent-ask", Id: id);

    /// <summary>Is this the parent code? (tray to service).</summary>
    public static PipeMessage ParentCode(string id, string code) => new("parent-code", Id: id, Text: code);

    /// <summary>Start parent mode for that long; null is "Until I end it" (tray to service).</summary>
    public static PipeMessage ParentStart(string id, int? minutes) => new("parent-start", Id: id, Minutes: minutes);

    /// <summary>"End now" (tray to service).</summary>
    public static PipeMessage ParentEnd(string id) => new("parent-end", Id: id);

    /// <summary>The answer to <c>parent-code</c>, <c>parent-start</c> or <c>parent-end</c> (service to tray).</summary>
    public static PipeMessage Done(string id, bool ok) => new("done", Id: id, Approved: ok);

    /// <summary>"Dad said no." (service to tray).</summary>
    public static PipeMessage ParentNo(string text) => new("parent-no", Text: text);

    /// <summary>One line, no newline at the end.</summary>
    public static string Encode(PipeMessage message) => JsonSerializer.Serialize(message, PipeJsonContext.Default.PipeMessage);

    /// <summary>Null when the line is not a JSON object with a string <c>type</c>.</summary>
    public static PipeMessage? Decode(string line)
    {
        try
        {
            return JsonSerializer.Deserialize(line, PipeJsonContext.Default.PipeMessage);
        }
        catch (JsonException)
        {
            return null;
        }
    }
}

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase, DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull, RespectNullableAnnotations = true, RespectRequiredConstructorParameters = true, UseStringEnumConverter = true)]
[JsonSerializable(typeof(PipeMessage))]
internal sealed partial class PipeJsonContext : JsonSerializerContext;
