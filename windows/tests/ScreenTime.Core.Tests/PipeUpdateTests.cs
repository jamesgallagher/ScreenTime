using ScreenTime.Core.Service;
using ScreenTime.Core.Tray;
using ScreenTime.Core.Update;
using Xunit;

namespace ScreenTime.Core.Tests;

/// <summary>CARD-071: the three update lines between the tray and the service (docs/SPEC.md §12.11).</summary>
public class PipeUpdateTests
{
    [Fact]
    public void TheTraySendsCheckAndUpdateNowWithAnId()
    {
        Assert.Equal("""{"type":"update-check","id":"u1"}""", PipeMessage.Encode(PipeMessage.CheckForUpdates("u1")));
        Assert.Equal("""{"type":"update-now","id":"u2"}""", PipeMessage.Encode(PipeMessage.UpdateNow("u2")));
    }

    [Fact]
    public void TheServiceSendsWhereTheUpdateStandsAndTheTrayReadsItBack()
    {
        var view = new UpdateView("0.1.130", UpdateStates.Ready, "0.1.131", 41_234_567);
        var line = PipeMessage.Encode(PipeMessage.UpdateOf(view));
        Assert.Equal("""{"type":"update","update":{"version":"0.1.130","state":"ready","offered":"0.1.131","sizeBytes":41234567}}""", line);
        Assert.Equal(view, PipeMessage.Decode(line)!.Update);
    }

    [Fact]
    public void AnUpToDateViewLeavesOutWhatIsNotThere()
    {
        var line = PipeMessage.Encode(PipeMessage.UpdateOf(new UpdateView("0.1.130", UpdateStates.UpToDate)));
        Assert.Equal("""{"type":"update","update":{"version":"0.1.130","state":"up-to-date"}}""", line);
    }

    [Fact]
    public void ARefusedReplyIsWrittenOnThePipe()
    {
        Assert.Equal("""{"type":"reply","id":"u1","result":"Refused"}""", PipeMessage.Encode(PipeMessage.Reply("u1", SendResult.Refused)));
    }
}
