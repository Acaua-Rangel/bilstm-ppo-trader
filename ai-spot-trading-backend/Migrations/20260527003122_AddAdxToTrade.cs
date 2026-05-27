using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AiSpotTrading.Backend.Migrations
{
    /// <inheritdoc />
    public partial class AddAdxToTrade : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "Adx",
                table: "Trades",
                type: "decimal(8,4)",
                precision: 8,
                scale: 4,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Trades_BinanceUid_Timestamp",
                table: "Trades",
                columns: new[] { "BinanceUid", "Timestamp" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Trades_BinanceUid_Timestamp",
                table: "Trades");

            migrationBuilder.DropColumn(
                name: "Adx",
                table: "Trades");
        }
    }
}
