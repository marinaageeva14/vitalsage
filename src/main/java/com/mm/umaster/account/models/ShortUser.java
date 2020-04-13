package com.mm.umaster.account.models;
import lombok.Data;

import java.util.Set;

@Data
public class ShortUser {
    private final Long id;
    private final String name;
    private final String email;
  //  private final Set<RoleType> roles;

    public ShortUser(User user) {
        this.id = user.getId();
        this.name = user.getName();
        this.email = user.getEmail();
     //   this.roles = user.getRoles();
    }
}
