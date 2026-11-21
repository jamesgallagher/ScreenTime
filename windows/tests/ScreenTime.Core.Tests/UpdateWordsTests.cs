using System.Text.Json;
using ScreenTime.Core.Update;
using Xunit;

namespace ScreenTime.Core.Tests;

/// <summary>The words in test-vectors/update-words.json, which the Kotlin tests read too (docs/SPEC.md §12.11).</summary>
public class UpdateWordsTests
{
    private static readonly JsonElement Root =
        JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "words", "update-words.json"))).RootElement;

    private static string? Text(JsonElement o, string name) =>
        o.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.String ? p.GetString() : null;

    private static long? Number(JsonElement o, string name) =>
        o.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.Number ? p.GetInt64() : null;

    [Fact]
    public void EveryStateHasTheSharedStatusAndButton()
    {
        foreach (var row in Root.GetProperty("states").EnumerateArray())
        {
            var view = new UpdateView("0.1.130", Text(row, "state")!, Text(row, "version"), Number(row, "sizeBytes"));
            Assert.Equal(Text(row, "status"), UpdateWords.Status(view));
            Assert.Equal(Text(row, "button"), UpdateWords.MainButton(view));
        }
    }

    [Fact]
    public void WhatWillHappenMatchesTheTrayLine()
    {
        Assert.Equal(UpdateWords.WhatWillHappen, Text(Root.GetProperty("whatWillHappen"), "windows"));
    }

    [Fact]
    public void OpeningThePanelChecksOnlyWhenNothingIsUnderWayAndNoRecentCheck()
    {
        foreach (var row in Root.GetProperty("checkOnOpen").EnumerateArray())
        {
            var view = new UpdateView("0.1.130", Text(row, "state")!, "0.1.131", 34_000_000);
            var expected = row.GetProperty("checks").GetBoolean();
            Assert.Equal(expected, UpdateWords.CheckOnOpen(view, Number(row, "secondsSinceLastCheck")));
        }
    }

    [Fact]
    public void TheVersionLabelIsVersionAndTheNumber()
    {
        Assert.Equal("Version 0.1.130", UpdateWords.VersionLabel(new UpdateView("0.1.130", UpdateStates.UpToDate)));
    }
}
