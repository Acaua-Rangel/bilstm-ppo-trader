using Microsoft.EntityFrameworkCore;
using AiSpotTrading.Backend.Data;
using FluentValidation;
using FluentValidation.AspNetCore;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddControllers();

// Configure Entity Framework with MySQL
var connectionString = builder.Configuration.GetConnectionString("DefaultConnection") 
    ?? "Server=localhost;Database=ai_spot_trading;User=root;Password=;";
var serverVersion = new MySqlServerVersion(new Version(8, 0, 31));

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseMySql(connectionString, serverVersion));

builder.Services.AddScoped<AiSpotTrading.Backend.Repositories.IUserRepository, AiSpotTrading.Backend.Repositories.UserRepository>();
builder.Services.AddScoped<AiSpotTrading.Backend.Repositories.IExchangeAccountRepository, AiSpotTrading.Backend.Repositories.ExchangeAccountRepository>();
builder.Services.AddScoped<AiSpotTrading.Backend.Repositories.ITradeRepository, AiSpotTrading.Backend.Repositories.TradeRepository>();


// Configure CORS
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowFrontend",
        policy =>
        {
            policy.WithOrigins("http://localhost:5173", "http://localhost:3000") // Vite/React default ports
                  .AllowAnyHeader()
                  .AllowAnyMethod();
        });
});

// Configure FluentValidation
builder.Services.AddFluentValidationAutoValidation();
builder.Services.AddValidatorsFromAssemblyContaining<Program>();

// Configure OpenAPI/Swagger
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var app = builder.Build();

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseHttpsRedirection();

app.UseCors("AllowFrontend");

app.UseAuthorization();

app.MapControllers();

app.Run();
