package com.mm.umaster.account.models;
import lombok.Data;

import java.util.Set;

@Data
public class ShortUser {
    Long id;
    String name;
    String email;
    Set<RoleType> roles;

    public ShortUser(User user) {
        this.id = user.id;
        this.name = user.name;
        this.email = user.email;
        this.roles = user.roles;
    }
}
