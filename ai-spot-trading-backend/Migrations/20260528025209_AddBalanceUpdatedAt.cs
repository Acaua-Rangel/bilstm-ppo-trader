using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AiSpotTrading.Backend.Migrations
{
    /// <inheritdoc />
    public partial class AddBalanceUpdatedAt : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "BalanceUpdatedAt",
                table: "ExchangeAccounts",
                type: "datetime(6)",
                nullable: false,
                defaultValue: new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified));
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "BalanceUpdatedAt",
                table: "ExchangeAccounts");
        }
    }
}
