using ScreenTime.Service;

var builder = Host.CreateApplicationBuilder(args);
builder.Services.AddWindowsService(options => options.ServiceName = "ScreenTime");
builder.Services.AddHostedService<Worker>();
builder.Build().Run();
