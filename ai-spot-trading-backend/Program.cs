using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;
using AiSpotTrading.Backend.Data;
using AiSpotTrading.Backend.Repositories;
using AiSpotTrading.Backend.Services;
using FluentValidation;
using FluentValidation.AspNetCore;
using MySqlConnector;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();

// Tratamento Cloud (Render): Grava o certificado em disco se for injetado via Variável de Ambiente
var caContent = Environment.GetEnvironmentVariable("MYSQL_SSL_CA_CONTENT");
if (!string.IsNullOrEmpty(caContent))
{
    System.IO.File.WriteAllText("/tmp/ca.pem", caContent.Replace("\\n", "\n"));
}

// EF Core / MySQL
var connectionString = builder.Configuration.GetConnectionString("DefaultConnection")
    ?? "Server=localhost;Database=ai_spot_trading;User=root;Password=;";
    
// Auto-patch da string de conexão se estivermos no Render e o arquivo existir no /tmp
if (System.IO.File.Exists("/tmp/ca.pem") && !connectionString.Contains("/tmp/ca.pem"))
{
    if (connectionString.Contains("SslCa=../ca.pem"))
        connectionString = connectionString.Replace("SslCa=../ca.pem", "SslCa=/tmp/ca.pem");
    else if (!connectionString.Contains("SslCa="))
        connectionString = connectionString.TrimEnd(';') + ";SslMode=Required;SslCa=/tmp/ca.pem;";
}

var serverVersion = new MySqlServerVersion(new Version(8, 0, 31));

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseMySql(connectionString, serverVersion));

// Repositories & services
builder.Services.AddScoped<IUserRepository, UserRepository>();
builder.Services.AddScoped<IExchangeAccountRepository, ExchangeAccountRepository>();
builder.Services.AddScoped<ITradeRepository, TradeRepository>();
builder.Services.AddSingleton<IEncryptionService, EncryptionService>();
builder.Services.AddSingleton<IJwtService, JwtService>();

// JWT auth — token vem do cookie HttpOnly `ast_session`.
var jwtSecret = builder.Configuration["Jwt:Secret"]
    ?? Environment.GetEnvironmentVariable("JWT_SECRET")
    ?? throw new InvalidOperationException("JWT_SECRET não configurado.");
var jwtIssuer = builder.Configuration["Jwt:Issuer"] ?? "AiSpotTrading";
var jwtAudience = builder.Configuration["Jwt:Audience"] ?? "AiSpotTrading.Frontend";

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = jwtIssuer,
            ValidAudience = jwtAudience,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSecret)),
            NameClaimType = "sub"
        };
        options.Events = new JwtBearerEvents
        {
            OnMessageReceived = ctx =>
            {
                if (ctx.Request.Cookies.TryGetValue("ast_session", out var token))
                    ctx.Token = token;
                return Task.CompletedTask;
            }
        };
    });

builder.Services.AddAuthorization();

builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowFrontend", policy =>
        policy.SetIsOriginAllowed(_ => true)
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials());
});

builder.Services.AddFluentValidationAutoValidation();
builder.Services.AddValidatorsFromAssemblyContaining<Program>();

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var app = builder.Build();

// CREATE DATABASE IF NOT EXISTS + EF migrations no startup.
using (var scope = app.Services.CreateScope())
{
    var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();
    try
    {
        var csb = new MySqlConnectionStringBuilder(connectionString);
        var databaseName = csb.Database;
        csb.Database = string.Empty;

        await using (var serverConn = new MySqlConnection(csb.ConnectionString))
        {
            await serverConn.OpenAsync();
            await using var cmd = serverConn.CreateCommand();
            cmd.CommandText = $"CREATE DATABASE IF NOT EXISTS `{databaseName}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;";
            await cmd.ExecuteNonQueryAsync();
        }
        logger.LogInformation("Database '{Db}' verificado/criado.", databaseName);

        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Database.MigrateAsync();
        logger.LogInformation("Migrations aplicadas com sucesso.");
    }
    catch (Exception ex)
    {
        logger.LogError(ex, "Falha ao inicializar o banco de dados.");
        throw;
    }
}

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseCors("AllowFrontend");
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();

var port = Environment.GetEnvironmentVariable("PORT") ?? "8080";
app.Run($"http://0.0.0.0:{port}");
