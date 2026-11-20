using System.Globalization;
using System.Xml.Linq;

namespace ScreenTime.Core.Sites;

/// <summary>One DNS lookup from a Windows event (docs/SPEC.md §12.10): who looked a name up, in which process, and when.</summary>
public sealed record DnsLookup(long AtMs, uint ProcessId, string UserSid, string QueryName, int QueryType, int QueryStatus);

/// <summary>Parses the XML of one event of <c>Microsoft-Windows-DNS-Client/Operational</c> (docs/SPEC.md §12.10).</summary>
public static class DnsEvents
{
    /// <summary>
    /// The lookup of one event 3008, or null when the event id is not 3008 or any of <c>QueryName</c>, <c>UserID</c>,
    /// <c>ProcessID</c>, <c>QueryStatus</c> or <c>TimeCreated</c> is missing or unreadable.
    /// </summary>
    public static DnsLookup? Parse(string xml)
    {
        try
        {
            var root = XDocument.Parse(xml).Root;
            var system = Child(root, "System");
            if (system is null) return null;
            var eventId = Child(system, "EventID")?.Value;
            if (eventId is null || !int.TryParse(eventId, out var id) || id != 3008) return null;
            var execution = Child(system, "Execution");
            var processId = execution?.Attribute("ProcessID")?.Value;
            if (processId is null || !uint.TryParse(processId, out var pid)) return null;
            var security = Child(system, "Security");
            var userSid = security?.Attribute("UserID")?.Value;
            if (string.IsNullOrEmpty(userSid)) return null;
            var timeCreated = Child(system, "TimeCreated");
            var systemTime = timeCreated?.Attribute("SystemTime")?.Value;
            if (systemTime is null) return null;
            var atMs = DateTimeOffset.Parse(systemTime, CultureInfo.InvariantCulture).ToUnixTimeMilliseconds();
            var data = Child(root, "EventData");
            var queryName = Data(data, "QueryName");
            if (string.IsNullOrEmpty(queryName)) return null;
            var queryType = Data(data, "QueryType");
            if (queryType is null || !int.TryParse(queryType, out var type)) return null;
            var queryStatus = Data(data, "QueryStatus");
            if (queryStatus is null || !int.TryParse(queryStatus, out var status)) return null;
            return new DnsLookup(atMs, pid, userSid, queryName, type, status);
        }
        catch
        {
            return null;
        }
    }

    private static XElement? Child(XElement? parent, string name) =>
        parent?.Elements().FirstOrDefault(e => e.Name.LocalName == name);

    private static string? Data(XElement? eventData, string name) =>
        eventData?.Elements().FirstOrDefault(e => e.Name.LocalName == "Data" && e.Attribute("Name")?.Value == name)?.Value;
}
