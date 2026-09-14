package ie.clubnight.scheduler;

public enum GameFormat {
    MENS_DOUBLES("Men's doubles"),
    WOMENS_DOUBLES("Women's doubles"),
    MIXED_DOUBLES("Mixed doubles"),
    OPEN_DOUBLES("Open doubles");

    private final String label;

    GameFormat(String label) {
        this.label = label;
    }

    public String label() {
        return label;
    }
}
